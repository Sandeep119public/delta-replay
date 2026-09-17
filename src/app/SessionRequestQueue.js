export class SessionRequestQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  enqueue(task) {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
