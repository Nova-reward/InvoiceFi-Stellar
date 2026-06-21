# InvoiceFi Backend

NestJS backend API for InvoiceFi Stellar - a decentralized harvest invoice financing protocol.

## Features

- **Invoice Management**: Create and manage harvest invoices
- **Notification System**: In-app notifications for users
- **Email Service**: SMTP-based email notifications
- **Scheduled Jobs**: BullMQ-based job queue with cron scheduling
- **Invoice Reminders**: Automated reminders for invoices due within 72 hours

## Tech Stack

- NestJS 10
- Prisma ORM
- PostgreSQL
- Redis (BullMQ)
- Nodemailer

## Environment Variables

See `.env.example` for required environment variables:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_HOST`: Redis server host
- `REDIS_PORT`: Redis server port
- `SMTP_HOST`: SMTP server host
- `SMTP_PORT`: SMTP server port
- `SMTP_USER`: SMTP username
- `SMTP_PASSWORD`: SMTP password
- `SMTP_FROM`: Default sender email

## Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Start development server
npm run start:dev
```

## Invoice Reminder System

The backend includes a scheduled job that runs every 6 hours to:

1. Query invoices with `due_date <= now + 72h` and status `FUNDED`
2. Send email notifications to farmers
3. Create in-app notification records
4. Retry failed jobs up to 3 times with exponential backoff

### Job Configuration

- **Queue**: `invoice-reminder`
- **Schedule**: Every 6 hours (cron: `0 */6 * * *`)
- **Retry Attempts**: 3
- **Backoff Strategy**: Exponential (5s initial delay)
- **Job Cleanup**: Keep 10 completed jobs, 50 failed jobs

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build backend
```

## API Endpoints

- `GET /` - API status
- `GET /health` - Health check endpoint
