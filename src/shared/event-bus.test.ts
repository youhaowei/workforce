import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EventBus,
  createEventBus,
  getEventBus,
  EventType,
  type TokenDeltaEvent,
  type ToolStartEvent,
  type TaskUpdateEvent as _TaskUpdateEvent,
  type BusEvent,
} from './event-bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = createEventBus();
  });

  afterEach(() => {
    bus.dispose();
  });

  describe('on/off subscription', () => {
    it('should subscribe and receive events', () => {
      const received: TokenDeltaEvent[] = [];
      bus.on(EventType.TokenDelta, (event) => {
        received.push(event);
      });

      const event: TokenDeltaEvent = {
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      };
      bus.emit(event);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(event);
    });

    it('should unsubscribe via returned function', () => {
      const received: TokenDeltaEvent[] = [];
      const unsubscribe = bus.on(EventType.TokenDelta, (event) => {
        received.push(event);
      });

      const event: TokenDeltaEvent = {
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      };
      bus.emit(event);
      unsubscribe();
      bus.emit(event);

      expect(received).toHaveLength(1);
    });

    it('should unsubscribe via off method', () => {
      const received: TokenDeltaEvent[] = [];
      const listener = (event: TokenDeltaEvent) => {
        received.push(event);
      };
      bus.on(EventType.TokenDelta, listener);

      const event: TokenDeltaEvent = {
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      };
      bus.emit(event);
      bus.off(EventType.TokenDelta, listener);
      bus.emit(event);

      expect(received).toHaveLength(1);
    });

    it('should not receive events of different types', () => {
      const received: TokenDeltaEvent[] = [];
      bus.on(EventType.TokenDelta, (event) => {
        received.push(event);
      });

      const toolEvent: ToolStartEvent = {
        type: 'ToolStart',
        toolId: '123',
        toolName: 'test',
        args: {},
        timestamp: Date.now(),
      };
      bus.emit(toolEvent);

      expect(received).toHaveLength(0);
    });
  });

  describe('once (one-time listeners)', () => {
    it('should only fire once', () => {
      const received: TokenDeltaEvent[] = [];
      bus.once(EventType.TokenDelta, (event) => {
        received.push(event);
      });

      const event: TokenDeltaEvent = {
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      };
      bus.emit(event);
      bus.emit(event);
      bus.emit(event);

      expect(received).toHaveLength(1);
    });

    it('should auto-remove after first invocation', () => {
      bus.once(EventType.TokenDelta, () => {});

      expect(bus.listenerCount(EventType.TokenDelta)).toBe(1);

      bus.emit({
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      });

      expect(bus.listenerCount(EventType.TokenDelta)).toBe(0);
    });
  });

  describe('wildcard subscriptions', () => {
    it('should receive all event types', () => {
      const received: BusEvent[] = [];
      bus.on(EventType.Wildcard, (event) => {
        received.push(event);
      });

      const tokenEvent: TokenDeltaEvent = {
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      };
      const toolEvent: ToolStartEvent = {
        type: 'ToolStart',
        toolId: '123',
        toolName: 'test',
        args: {},
        timestamp: Date.now(),
      };

      bus.emit(tokenEvent);
      bus.emit(toolEvent);

      expect(received).toHaveLength(2);
      expect(received[0]).toBe(tokenEvent);
      expect(received[1]).toBe(toolEvent);
    });

    it('should work with once for wildcards', () => {
      const received: BusEvent[] = [];
      bus.once(EventType.Wildcard, (event) => {
        received.push(event);
      });

      bus.emit({
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      });
      bus.emit({
        type: 'ToolStart',
        toolId: '123',
        toolName: 'test',
        args: {},
        timestamp: Date.now(),
      });

      expect(received).toHaveLength(1);
    });
  });

  describe('priority ordering', () => {
    it('should call higher priority listeners first', () => {
      const order: number[] = [];

      bus.on(EventType.TokenDelta, () => order.push(1), { priority: 1 });
      bus.on(EventType.TokenDelta, () => order.push(3), { priority: 3 });
      bus.on(EventType.TokenDelta, () => order.push(2), { priority: 2 });

      bus.emit({
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      });

      expect(order).toEqual([3, 2, 1]);
    });
  });

  describe('async listeners', () => {
    it('should handle async listeners without blocking emit', async () => {
      let asyncCompleted = false;
      bus.on(EventType.TokenDelta, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        asyncCompleted = true;
      });

      bus.emit({
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      });

      expect(asyncCompleted).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(asyncCompleted).toBe(true);
    });

    it('should wait for async listeners with emitAsync', async () => {
      let asyncCompleted = false;
      bus.on(EventType.TokenDelta, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        asyncCompleted = true;
      });

      await bus.emitAsync({
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      });

      expect(asyncCompleted).toBe(true);
    });

    it('should catch async errors without crashing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.on(EventType.TokenDelta, async () => {
        throw new Error('Async error');
      });

      await bus.emitAsync({
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('backpressure controller', () => {
    it('should pause and resume event dispatch', () => {
      const received: TokenDeltaEvent[] = [];
      const controller = bus.getBackpressureController();

      bus.on(EventType.TokenDelta, (event) => {
        received.push(event);
      });

      controller.pause();
      expect(controller.isPaused()).toBe(true);

      bus.emit({
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      });

      expect(received).toHaveLength(0);
      expect(controller.queueSize()).toBe(1);

      controller.resume();
      expect(controller.isPaused()).toBe(false);
      expect(received).toHaveLength(1);
      expect(controller.queueSize()).toBe(0);
    });

    it('should clear queued events', () => {
      const received: TokenDeltaEvent[] = [];
      const controller = bus.getBackpressureController();

      bus.on(EventType.TokenDelta, (event) => {
        received.push(event);
      });

      controller.pause();
      bus.emit({
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      });

      expect(controller.queueSize()).toBe(1);
      controller.clear();
      expect(controller.queueSize()).toBe(0);

      controller.resume();
      expect(received).toHaveLength(0);
    });
  });

  describe('zero-copy event passing', () => {
    it('should pass event by reference not clone', () => {
      let receivedEvent: TokenDeltaEvent | null = null;
      bus.on(EventType.TokenDelta, (event) => {
        receivedEvent = event;
      });

      const event: TokenDeltaEvent = {
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      };
      bus.emit(event);

      expect(receivedEvent).toBe(event);
    });
  });

  describe('listener management', () => {
    it('should track listener count', () => {
      expect(bus.listenerCount(EventType.TokenDelta)).toBe(0);

      const unsub1 = bus.on(EventType.TokenDelta, () => {});
      const unsub2 = bus.on(EventType.TokenDelta, () => {});
      bus.on(EventType.ToolStart, () => {});

      expect(bus.listenerCount(EventType.TokenDelta)).toBe(2);
      expect(bus.listenerCount(EventType.ToolStart)).toBe(1);
      expect(bus.totalListenerCount()).toBe(3);

      unsub1();
      expect(bus.listenerCount(EventType.TokenDelta)).toBe(1);

      unsub2();
      expect(bus.listenerCount(EventType.TokenDelta)).toBe(0);
    });

    it('should remove all listeners for a type', () => {
      bus.on(EventType.TokenDelta, () => {});
      bus.on(EventType.TokenDelta, () => {});
      bus.on(EventType.ToolStart, () => {});

      bus.removeAllListeners(EventType.TokenDelta);

      expect(bus.listenerCount(EventType.TokenDelta)).toBe(0);
      expect(bus.listenerCount(EventType.ToolStart)).toBe(1);
    });

    it('should remove all listeners', () => {
      bus.on(EventType.TokenDelta, () => {});
      bus.on(EventType.ToolStart, () => {});

      bus.removeAllListeners();

      expect(bus.totalListenerCount()).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should continue dispatching after listener error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const received: number[] = [];

      bus.on(EventType.TokenDelta, () => received.push(1), { priority: 3 });
      bus.on(
        EventType.TokenDelta,
        () => {
          throw new Error('Listener error');
        },
        { priority: 2 }
      );
      bus.on(EventType.TokenDelta, () => received.push(3), { priority: 1 });

      bus.emit({
        type: 'TokenDelta',
        token: 'hello',
        index: 0,
        timestamp: Date.now(),
      });

      expect(received).toEqual([1, 3]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('dispose', () => {
    it('should clean up on dispose', () => {
      bus.on(EventType.TokenDelta, () => {});
      bus.on(EventType.ToolStart, () => {});

      bus.dispose();

      expect(bus.totalListenerCount()).toBe(0);
    });
  });

  describe('singleton', () => {
    it('should return same instance from getEventBus', () => {
      const bus1 = getEventBus();
      const bus2 = getEventBus();
      expect(bus1).toBe(bus2);
    });
  });

  describe('type safety', () => {
    it('should enforce typed event payloads', () => {
      bus.on(EventType.TokenDelta, (event) => {
        expect(event.type).toBe('TokenDelta');
        expect(typeof event.token).toBe('string');
        expect(typeof event.index).toBe('number');
      });

      bus.on(EventType.TaskUpdate, (event) => {
        expect(event.type).toBe('TaskUpdate');
        expect(typeof event.taskId).toBe('string');
        expect(['pending', 'running', 'completed', 'failed', 'cancelled']).toContain(event.status);
      });

      bus.emit({
        type: 'TokenDelta',
        token: 'test',
        index: 0,
        timestamp: Date.now(),
      });

      bus.emit({
        type: 'TaskUpdate',
        taskId: 'task-1',
        status: 'running',
        timestamp: Date.now(),
      });
    });
  });
});

describe('EventBus Memory', () => {
  it('should not grow memory after subscribe/unsubscribe cycles', () => {
    const bus = createEventBus();
    const iterations = 10000;

    const startMemory = process.memoryUsage().heapUsed;

    for (let i = 0; i < iterations; i++) {
      const unsub = bus.on(EventType.TokenDelta, () => {});
      unsub();
    }

    global.gc?.();
    const endMemory = process.memoryUsage().heapUsed;
    const memoryGrowth = endMemory - startMemory;

    expect(bus.listenerCount(EventType.TokenDelta)).toBe(0);
    expect(memoryGrowth).toBeLessThan(5 * 1024 * 1024);

    bus.dispose();
  });
});

describe('EventBus Performance', () => {
  it('should dispatch events in under 0.1ms', () => {
    const bus = createEventBus();

    bus.on(EventType.TokenDelta, () => {});
    bus.on(EventType.TokenDelta, () => {});
    bus.on(EventType.TokenDelta, () => {});

    const event: TokenDeltaEvent = {
      type: 'TokenDelta',
      token: 'hello',
      index: 0,
      timestamp: Date.now(),
    };

    const warmup = 1000;
    for (let i = 0; i < warmup; i++) {
      bus.emit(event);
    }

    const iterations = 10000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      bus.emit(event);
    }

    const end = performance.now();
    const avgLatency = (end - start) / iterations;

    expect(avgLatency).toBeLessThan(0.1);

    bus.dispose();
  });
});
