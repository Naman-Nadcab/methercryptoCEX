import amqp, { Channel, type ChannelModel, ConsumeMessage } from 'amqplib';
import { config } from '../config/index.js';
import { logger } from './logger.js';

// Queue and Exchange names
export const EXCHANGES = {
  ORDERS: 'exchange.orders',
  TRADES: 'exchange.trades',
  WALLETS: 'exchange.wallets',
  NOTIFICATIONS: 'exchange.notifications',
  P2P: 'exchange.p2p',
} as const;

export const QUEUES = {
  // Order processing
  ORDER_CREATED: 'orders.created',
  ORDER_MATCHED: 'orders.matched',
  ORDER_CANCELLED: 'orders.cancelled',
  ORDER_FILLED: 'orders.filled',
  
  // Trade processing
  TRADE_EXECUTED: 'trades.executed',
  TRADE_SETTLED: 'trades.settled',
  
  // Wallet operations
  WALLET_DEPOSIT: 'wallets.deposit',
  WALLET_WITHDRAWAL: 'wallets.withdrawal',
  WALLET_BALANCE_UPDATE: 'wallets.balance.update',
  
  // Notifications
  NOTIFICATION_EMAIL: 'notifications.email',
  NOTIFICATION_SMS: 'notifications.sms',
  NOTIFICATION_PUSH: 'notifications.push',
  
  // P2P
  P2P_ORDER_CREATED: 'p2p.order.created',
  P2P_PAYMENT_CONFIRMED: 'p2p.payment.confirmed',
  P2P_DISPUTE_OPENED: 'p2p.dispute.opened',
  P2P_ESCROW_RELEASED: 'p2p.escrow.released',

  // OTP delivery (async, non-blocking)
  OTP_SEND: 'otp.send',
} as const;

export const ROUTING_KEYS = {
  ORDER_NEW: 'order.new',
  ORDER_CANCEL: 'order.cancel',
  ORDER_UPDATE: 'order.update',
  TRADE_NEW: 'trade.new',
  BALANCE_UPDATE: 'balance.update',
  DEPOSIT_CONFIRMED: 'deposit.confirmed',
  WITHDRAWAL_PROCESSED: 'withdrawal.processed',
} as const;

type MessageHandler<T> = (message: T, ack: () => void, nack: (requeue?: boolean) => void) => Promise<void>;

class RabbitMQClient {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private static instance: RabbitMQClient;
  private reconnecting = false;
  private consumers: Map<string, MessageHandler<unknown>> = new Map();

  public static getInstance(): RabbitMQClient {
    if (!RabbitMQClient.instance) {
      RabbitMQClient.instance = new RabbitMQClient();
    }
    return RabbitMQClient.instance;
  }

  async connect(): Promise<void> {
    try {
      const conn = await amqp.connect(config.rabbitmq.url);
      this.connection = conn;
      const ch = await conn.createChannel();
      this.channel = ch;

      // Set prefetch for fair dispatch
      await ch.prefetch(10);

      // Setup connection error handlers
      conn.on('error', (err) => {
        logger.error('RabbitMQ connection error', { error: err instanceof Error ? err.message : 'Unknown' });
        this.handleReconnect();
      });

      conn.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        this.handleReconnect();
      });

      // Initialize exchanges and queues
      await this.setupTopology();

      logger.info('RabbitMQ connected and topology configured');
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ', { 
        error: error instanceof Error ? error.message : 'Unknown' 
      });
      throw error;
    }
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    const maxRetries = 10;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * Math.pow(2, retries), 30000)));
        await this.connect();
        
        // Re-register consumers
        for (const [queue, handler] of this.consumers) {
          await this.consume(queue, handler);
        }
        
        this.reconnecting = false;
        logger.info('RabbitMQ reconnected successfully');
        return;
      } catch (error) {
        retries++;
        logger.warn(`RabbitMQ reconnection attempt ${retries} failed`);
      }
    }

    logger.error('RabbitMQ max reconnection attempts reached');
    this.reconnecting = false;
  }

  private async setupTopology(): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    // Declare exchanges
    for (const exchange of Object.values(EXCHANGES)) {
      await this.channel.assertExchange(exchange, 'topic', { durable: true });
    }

    // Declare queues with dead-letter exchange
    await this.channel.assertExchange('exchange.dlx', 'direct', { durable: true });

    for (const queue of Object.values(QUEUES)) {
      await this.channel.assertQueue(queue, {
        durable: true,
        deadLetterExchange: 'exchange.dlx',
        deadLetterRoutingKey: `dlx.${queue}`,
      });

      // Create dead-letter queue
      await this.channel.assertQueue(`dlx.${queue}`, { durable: true });
      await this.channel.bindQueue(`dlx.${queue}`, 'exchange.dlx', `dlx.${queue}`);
    }

    // Bind queues to exchanges
    await this.channel.bindQueue(QUEUES.ORDER_CREATED, EXCHANGES.ORDERS, ROUTING_KEYS.ORDER_NEW);
    await this.channel.bindQueue(QUEUES.ORDER_CANCELLED, EXCHANGES.ORDERS, ROUTING_KEYS.ORDER_CANCEL);
    await this.channel.bindQueue(QUEUES.TRADE_EXECUTED, EXCHANGES.TRADES, ROUTING_KEYS.TRADE_NEW);
    await this.channel.bindQueue(QUEUES.WALLET_DEPOSIT, EXCHANGES.WALLETS, ROUTING_KEYS.DEPOSIT_CONFIRMED);
    await this.channel.bindQueue(QUEUES.WALLET_WITHDRAWAL, EXCHANGES.WALLETS, ROUTING_KEYS.WITHDRAWAL_PROCESSED);
    await this.channel.bindQueue(QUEUES.WALLET_BALANCE_UPDATE, EXCHANGES.WALLETS, ROUTING_KEYS.BALANCE_UPDATE);
  }

  async publish<T>(exchange: string, routingKey: string, message: T): Promise<boolean> {
    if (!this.channel) {
      logger.error('Cannot publish: channel not initialized');
      return false;
    }

    try {
      const content = Buffer.from(JSON.stringify(message));
      const result = this.channel.publish(exchange, routingKey, content, {
        persistent: true,
        contentType: 'application/json',
        timestamp: Date.now(),
      });

      if (!result) {
        logger.warn('Message publish returned false, buffer may be full');
      }

      return result;
    } catch (error) {
      logger.error('Failed to publish message', {
        exchange,
        routingKey,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return false;
    }
  }

  async sendToQueue<T>(queue: string, message: T, options?: { priority?: number; expiration?: string }): Promise<boolean> {
    if (!this.channel) {
      logger.error('Cannot send to queue: channel not initialized');
      return false;
    }

    try {
      const content = Buffer.from(JSON.stringify(message));
      return this.channel.sendToQueue(queue, content, {
        persistent: true,
        contentType: 'application/json',
        timestamp: Date.now(),
        ...options,
      });
    } catch (error) {
      logger.error('Failed to send to queue', {
        queue,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return false;
    }
  }

  async consume<T>(queue: string, handler: MessageHandler<T>): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    this.consumers.set(queue, handler as MessageHandler<unknown>);

    await this.channel.consume(queue, async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      try {
        const content = JSON.parse(msg.content.toString()) as T;
        
        await handler(
          content,
          () => this.channel?.ack(msg),
          (requeue = false) => this.channel?.nack(msg, false, requeue)
        );
      } catch (error) {
        logger.error('Error processing message', {
          queue,
          error: error instanceof Error ? error.message : 'Unknown',
        });
        // Nack without requeue - let it go to DLX
        this.channel?.nack(msg, false, false);
      }
    });

    logger.info(`Consumer registered for queue: ${queue}`);
  }

  async healthCheck(): Promise<boolean> {
    return this.connection !== null && this.channel !== null;
  }

  async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      logger.info('RabbitMQ connection closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  getChannel(): Channel | null {
    return this.channel;
  }
}

export const rabbitmq = RabbitMQClient.getInstance();

// Message types for type safety
export interface OrderCreatedMessage {
  orderId: string;
  userId: string;
  pair: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_loss';
  price?: string;
  quantity: string;
  timestamp: number;
}

export interface TradeExecutedMessage {
  tradeId: string;
  orderId: string;
  matchedOrderId: string;
  pair: string;
  price: string;
  quantity: string;
  buyerId: string;
  sellerId: string;
  timestamp: number;
}

export interface BalanceUpdateMessage {
  userId: string;
  asset: string;
  available: string;
  locked: string;
  type: 'credit' | 'debit' | 'lock' | 'unlock';
  reason: string;
  referenceId: string;
  timestamp: number;
}

export interface NotificationMessage {
  userId: string;
  type: 'email' | 'sms' | 'push';
  template: string;
  data: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high';
}

export interface P2PEscrowMessage {
  escrowId: string;
  orderId: string;
  sellerId: string;
  buyerId: string;
  asset: string;
  amount: string;
  action: 'created' | 'released' | 'disputed' | 'cancelled';
  timestamp: number;
}
