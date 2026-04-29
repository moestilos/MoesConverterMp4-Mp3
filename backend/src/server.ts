import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import { config } from './config.js';
import { router as convertRouter } from './routes/convert.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { trackRouter } from './routes/track.js';
import { meRouter } from './routes/me.js';
import { transcribeRouter } from './routes/transcribe.js';
import { startCleanupLoop } from './utils/cleanup.js';
import { seedAdmin } from './services/auth.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'moesconverter-backend' });
});

app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/track', trackRouter);
app.use('/me', meRouter);
app.use('/api', convertRouter);
app.use('/api/transcribe', transcribeRouter);

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

app.use(
  (err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', err);
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  },
);

startCleanupLoop();

seedAdmin().catch((err) => {
  console.error('[seed]', err);
});

app.listen(config.port, () => {
  console.log(`[backend] MoesConverter API listening on :${config.port}`);
  console.log(`[backend] uploads -> ${config.uploadDir}`);
  console.log(`[backend] outputs -> ${config.outputDir}`);
});
