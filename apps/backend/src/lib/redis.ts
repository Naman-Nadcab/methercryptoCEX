import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';

class RedisClient {
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;
  private static instance: RedisClient;

  private constructor() {
    const options: Redis.RedisOptions = {
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null; // Stop retrying
        const delay = Math.min(times * 100, 2000);
        return delay;
      },
      connectTimeout: 5000,
    };

    if (config.redis.password) {
      options.password = config.redis.password;
    }

    this.client = new Redis(options);
    this.subscriber = new Redis(options);
    this.publisher = new Redis(options);

    this.setupEventHandlers(this.client, 'main');
    this.setupEventHandlers(this.subscriber, 'subscriber');
    this.setupEventHandlers(this.publisher, 'publisher');
  }

  private setupEventHandlers(client: Redis, name: string): void {
    client.on('connect', () => {
      logger.info(`Redis ${name} client connected`);
    });

    client.on('error', (err) => {
      logger.error(`Redis ${name} client error`, { error: err.message });
    });

    client.on('close', () => {
      logger.warn(`Redis ${name} client connection closed`);
    });
  }

  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  async connect(): Promise<void> {
    // Connections are established automatically without lazyConnect
    // Just wait for ready state
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        if (this.client.status === 'ready') resolve();
        else {
          this.client.once('ready', resolve);
          this.client.once('error', reject);
        }
      }),
      new Promise<void>((resolve, reject) => {
        if (this.subscriber.status === 'ready') resolve();
        else {
          this.subscriber.once('ready', resolve);
          this.subscriber.once('error', reject);
        }
      }),
      new Promise<void>((resolve, reject) => {
        if (this.publisher.status === 'ready') resolve();
        else {
          this.publisher.once('ready', resolve);
          this.publisher.once('error', reject);
        }
      }),
    ]);
  }

  // Basic operations
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  // JSON operations
  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.client.hincrby(key, field, increment);
  }

  // Sorted set operations (for orderbook)
  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member);
  }

  async zrem(key: string, member: string): Promise<void> {
    await this.client.zrem(key, member);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, start, stop);
  }

  async zrangeWithScores(
    key: string,
    start: number,
    stop: number
  ): Promise<Array<{ value: string; score: number }>> {
    const result = await this.client.zrange(key, start, stop, 'WITHSCORES');
    const items: Array<{ value: string; score: number }> = [];
    for (let i = 0; i < result.length; i += 2) {
      items.push({
        value: result[i]!,
        score: parseFloat(result[i + 1]!),
      });
    }
    return items;
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrevrange(key, start, stop);
  }

  async zrevrangeWithScores(
    key: string,
    start: number,
    stop: number
  ): Promise<Array<{ value: string; score: number }>> {
    const result = await this.client.zrevrange(key, start, stop, 'WITHSCORES');
    const items: Array<{ value: string; score: number }> = [];
    for (let i = 0; i < result.length; i += 2) {
      items.push({
        value: result[i]!,
        score: parseFloat(result[i + 1]!),
      });
    }
    return items;
  }

  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max);
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  // List operations
  async lpush(key: string, value: string): Promise<void> {
    await this.client.lpush(key, value);
  }

  async rpush(key: string, value: string): Promise<void> {
    await this.client.rpush(key, value);
  }

  async lpop(key: string): Promise<string | null> {
    return this.client.lpop(key);
  }

  async rpop(key: string): Promise<string | null> {
    return this.client.rpop(key);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  // Rate limiting
  async rateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    const multi = this.client.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zadd(key, now, `${now}-${Math.random()}`);
    multi.zcard(key);
    multi.expire(key, windowSeconds);

    const results = await multi.exec();
    const count = results?.[2]?.[1] as number;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: now + windowSeconds * 1000,
    };
  }

  // Pub/Sub
  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
  }

  async subscribe(
    channel: string,
    callback: (message: string) => void
  ): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        callback(message);
      }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }

  // Lock operations (distributed locking)
  async acquireLock(
    key: string,
    ttlMs: number,
    retryCount = 3,
    retryDelayMs = 100
  ): Promise<string | null> {
    const lockKey = `lock:${key}`;
    const lockValue = `${Date.now()}-${Math.random()}`;

    for (let i = 0; i < retryCount; i++) {
      const result = await this.client.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
      if (result === 'OK') {
        return lockValue;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    return null;
  }

  async releaseLock(key: string, lockValue: string): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.client.eval(script, 1, lockKey, lockValue);
    return result === 1;
  }

  // Atomic increment with limit
  async incrementWithLimit(
    key: string,
    limit: number,
    ttlSeconds?: number
  ): Promise<{ success: boolean; current: number }> {
    const script = `
      local current = redis.call("INCR", KEYS[1])
      if ARGV[2] and current == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[2])
      end
      if current > tonumber(ARGV[1]) then
        redis.call("DECR", KEYS[1])
        return {0, current - 1}
      end
      return {1, current}
    `;
    const result = (await this.client.eval(
      script,
      1,
      key,
      limit,
      ttlSeconds || ''
    )) as [number, number];
    return {
      success: result[0] === 1,
      current: result[1],
    };
  }

  // Pipeline for batch operations
  pipeline(): Redis.ChainableCommander {
    return this.client.pipeline();
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  // Simple ping
  async ping(): Promise<string> {
    return this.client.ping();
  }

  // Graceful shutdown
  async close(): Promise<void> {
    await Promise.all([
      this.client.quit(),
      this.subscriber.quit(),
      this.publisher.quit(),
    ]);
    logger.info('Redis connections closed');
  }

  // Get raw client for advanced operations
  getClient(): Redis {
    return this.client;
  }
}

export const redis = RedisClient.getInstance();
