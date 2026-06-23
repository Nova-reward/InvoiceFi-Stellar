import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { InvoiceEvent } from './invoice-event.dto';

@WebSocketGateway({ cors: { origin: '*' } })
export class NotificationsGateway {
  @WebSocketServer()
  server: Server;

  /** Broadcast an invoice lifecycle event to all connected clients. */
  emitInvoiceEvent(event: InvoiceEvent): void {
    this.server.emit('invoice_event', event);
  }

  /** Allow clients to publish events directly (e.g. from Next.js server action). */
  @SubscribeMessage('publish_invoice_event')
  handlePublish(@MessageBody() event: InvoiceEvent): void {
    this.emitInvoiceEvent(event);
  }
}
