import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { Client } from 'pg';
import { PrismaService } from '../prisma/prisma.service';

export interface TemporaryPostgres {
  readonly name: string;
  readonly url: string;
  readonly prisma: PrismaService;
  close(): Promise<void>;
}

function quoteIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

function databaseUrl(originUrl: string, databaseName: string): string {
  const url = new URL(originUrl);
  url.pathname = '/' + databaseName;
  return url.href;
}

async function withAdminClient<T>(originUrl: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl(originUrl, 'postgres') });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function createTemporaryPostgres(baseName: string): Promise<TemporaryPostgres> {
  const originUrl = process.env.DATABASE_URL;
  if (!originUrl) throw new Error('DATABASE_URL absente.');

  const name = `${baseName}_${process.pid}_${randomBytes(4).toString('hex')}`.slice(0, 63);
  const identifier = quoteIdentifier(name);
  const url = databaseUrl(originUrl, name);

  await withAdminClient(originUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${identifier}`);
  });

  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
    const prisma = new PrismaService(url);
    await prisma.$connect();

    let closed = false;
    return {
      name,
      url,
      prisma,
      async close() {
        if (closed) return;
        closed = true;
        await prisma.$disconnect().catch(() => undefined);
        await withAdminClient(originUrl, async (client) => {
          await client.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`);
        });
      },
    };
  } catch (error) {
    await withAdminClient(originUrl, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`);
    }).catch(() => undefined);
    throw error;
  }
}