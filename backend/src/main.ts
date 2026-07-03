import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers — CSP, X-Frame-Options, HSTS, etc.
  app.use(helmet());

  const allowedOrigins = [
    'https://admin-theta-beryl-35.vercel.app',
    'https://admin-dw76jzh21-yashu1t508s-projects.vercel.app',
    /https:\/\/admin-.*\.vercel\.app$/,
    'http://localhost:3001',
    'http://localhost:4200',
  ];

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile app, curl, Render health checks)
      if (!origin) return callback(null, true);
      const allowed = allowedOrigins.some((o) =>
        typeof o === 'string' ? o === origin : o.test(origin),
      );
      callback(allowed ? null : new Error('CORS: origin not allowed'), allowed);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  Logger.log(`Listening on :${port}`, 'Bootstrap');
}

void bootstrap();
