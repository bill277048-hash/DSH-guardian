/**
 * 异步互斥锁（tryAcquire 变体，不排队）。
 *
 * 为什么不排队：插件的用户场景是 WebUI 面板上的启停点击，锁被占用说明
 * 上一个启停操作仍在进行中，此时再发起操作没有排队价值——直接让上层
 * 返回 409 BUSY，由用户稍后重试，语义更清晰也避免操作堆积。
 *
 * 实现说明：JS 单线程事件循环内「检查 + 置位」之间没有 await，
 * 因此布尔占位即可保证互斥，无需真正的 promise 链等待；
 * tail 字段保留与架构类图对齐的链尾指针语义（当前实现不排队故恒 resolved）。
 */
export class AsyncMutex {
  #locked = false;
  /** promise 链尾指针（tryAcquire 变体不排队，仅保持结构对齐）。 */
  #tail = Promise.resolve();

  /**
   * 尝试获取锁。
   * @returns {Promise<(() => void) | null>} 成功返回释放函数（幂等）；锁被占用返回 null。
   */
  async acquire() {
    if (this.#locked) return null;
    this.#locked = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#locked = false;
      // 保持链尾语义：释放即推进（无等待者时为空操作）。
      this.#tail = this.#tail.then(() => undefined);
    };
  }
}
