import "dotenv/config";

// Tests must never touch the development database
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL in .env to run tests (a separate, disposable database).");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
