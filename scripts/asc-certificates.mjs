#!/usr/bin/env node
// App Store Connect certificate housekeeping.
//
// Cloud-managed signing asks Apple for a certificate on every release run — one
// for the development-signed archive, one for the distribution export — and the
// private keys die with the runner's ephemeral keychain. What is left behind is
// a certificate nobody can ever sign with again, occupying one of the few slots
// Apple allows. Enough runs and the next request is refused outright, which is
// how v0.2.9 failed: "Your account has reached the maximum number of
// certificates".
//
// So the pipeline revokes what it created, in the same run that created it. It
// never sweeps the account: a certificate this script did not watch appear is
// somebody's Mac, and revoking that is a surprise nobody asked for.
//
// No dependencies on purpose. It is one JWT and two REST calls, and it runs on
// a fresh runner where `npm ci` has not necessarily happened yet.

import { sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const API = 'https://api.appstoreconnect.apple.com/v1/certificates';

const die = (message) => {
  console.error(`asc-certificates: ${message}`);
  process.exit(1);
};

const env = (name) => process.env[name] || die(`${name} is not set.`);

function privateKey() {
  const inline = process.env.ASC_PRIVATE_KEY;
  if (inline) return inline;
  const path = env('ASC_KEY_PATH');
  if (!existsSync(path)) die(`ASC_KEY_PATH points at ${path}, which does not exist.`);
  return readFileSync(path, 'utf8');
}

const base64url = (value) => Buffer.from(value).toString('base64url');

function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: env('ASC_KEY_ID'), typ: 'JWT' }));
  // Apple rejects a lifetime over 20 minutes outright. Ten is more than a sweep
  // needs and leaves nothing usable lying around if a log ever caught one.
  const claims = { iss: env('ASC_ISSUER_ID'), iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };
  const payload = base64url(JSON.stringify(claims));
  // JWS wants the raw r‖s pair. Node's default DER encoding is accepted by the
  // signing call and then rejected by Apple as a bare 401 with no body, which
  // is an hour of your life if you do not already know.
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey(),
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${base64url(signature)}`;
}

async function call(jwt, url, method = 'GET') {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${jwt}` } });
  if (response.status === 204) return null;
  const body = await response.text();
  if (!response.ok) die(`${method} ${url} → ${response.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

async function list(jwt) {
  const found = [];
  let url = `${API}?limit=200`;
  while (url) {
    const page = await call(jwt, url);
    for (const item of page.data) {
      found.push({
        id: item.id,
        type: item.attributes.certificateType,
        name: item.attributes.displayName || item.attributes.name || '',
        serial: item.attributes.serialNumber || '',
        expires: (item.attributes.expirationDate || '').slice(0, 10),
      });
    }
    url = page.links?.next ?? null;
  }
  return found;
}

async function revoke(jwt, certificate) {
  const response = await fetch(`${API}/${certificate.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  // 404 means somebody revoked it between the list and here, which is the state
  // we wanted anyway.
  if (!response.ok && response.status !== 404) {
    die(`DELETE ${API}/${certificate.id} → ${response.status} ${await response.text()}`);
  }
  console.error(`revoked ${certificate.type} ${certificate.id} (${certificate.name || certificate.serial})`);
}

const USAGE = `Usage:
  asc-certificates list [--ids]
  asc-certificates revoke --not-in <file> [--yes]
  asc-certificates revoke --all [--yes]
  asc-certificates revoke --id <id> [--id <id> ...] [--yes]

Environment: ASC_KEY_ID, ASC_ISSUER_ID, and one of ASC_KEY_PATH or ASC_PRIVATE_KEY.
Without --yes nothing is revoked and the selection is printed instead.`;

function parse(argv) {
  const options = { command: argv[0], ids: [], yes: false, all: false, idsOnly: false, notIn: null };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--ids') options.idsOnly = true;
    else if (arg === '--id') options.ids.push(argv[(i += 1)]);
    else if (arg === '--not-in') options.notIn = argv[(i += 1)];
    else die(`unknown argument ${arg}\n\n${USAGE}`);
  }
  return options;
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.command !== 'list' && options.command !== 'revoke') die(`expected "list" or "revoke".\n\n${USAGE}`);

  const jwt = token();
  const certificates = await list(jwt);

  if (options.command === 'list') {
    if (options.idsOnly) {
      // One id per line, and nothing else on stdout — this is what the release
      // workflow snapshots and later diffs against.
      for (const certificate of certificates) console.log(certificate.id);
      return;
    }
    console.error(`${certificates.length} certificate(s) on the account:`);
    for (const c of certificates) console.log(`${c.id}\t${c.type}\t${c.expires}\t${c.serial}\t${c.name}`);
    return;
  }

  let selected;
  if (options.notIn) {
    // A missing snapshot means the step that writes it never got there. Treat
    // that as "nothing is known to be new" rather than "everything is new":
    // the failure mode of guessing wrong here is revoking the certificate on
    // somebody's Mac.
    if (!existsSync(options.notIn)) {
      console.error(`no snapshot at ${options.notIn} — nothing to clean up.`);
      return;
    }
    const before = new Set(readFileSync(options.notIn, 'utf8').split('\n').filter(Boolean));
    selected = certificates.filter((c) => !before.has(c.id));
  } else if (options.all) {
    selected = certificates;
  } else if (options.ids.length) {
    selected = certificates.filter((c) => options.ids.includes(c.id));
  } else {
    die(`revoke needs --not-in, --all or --id\n\n${USAGE}`);
  }

  if (!selected.length) {
    console.error('nothing to revoke.');
    return;
  }
  if (!options.yes) {
    console.error(`would revoke ${selected.length} certificate(s) — pass --yes to do it:`);
    for (const c of selected) console.log(`${c.id}\t${c.type}\t${c.expires}\t${c.serial}\t${c.name}`);
    return;
  }
  for (const certificate of selected) await revoke(jwt, certificate);
  console.error(`revoked ${selected.length} certificate(s).`);
}

await main();
