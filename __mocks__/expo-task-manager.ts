/**
 * TaskManager, off-device.
 *
 * `defineTask` records the handler rather than discarding it, so a test can
 * invoke the background task directly and assert what it wrote — which is the
 * only way to exercise the code path that runs while the app is closed.
 */
type TaskHandler = (body: { data?: unknown; error?: { message: string } | null }) => unknown;

const tasks = new Map<string, TaskHandler>();

export const defineTask = jest.fn((name: string, handler: TaskHandler) => {
  tasks.set(name, handler);
});

export const isTaskRegisteredAsync = jest.fn(async (name: string) => tasks.has(name));
export const unregisterTaskAsync = jest.fn(async (name: string) => {
  tasks.delete(name);
});

/** Test-only: run a registered task as iOS would. */
export async function __invoke(name: string, body: Parameters<TaskHandler>[0]): Promise<void> {
  await tasks.get(name)?.(body);
}
