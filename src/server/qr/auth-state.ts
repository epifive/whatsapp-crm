import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * Baileys auth state stored in Postgres (encrypted with APP_KEY) instead of session files, so QR
 * logins survive restarts and redeploys and never sit in plain text on disk.
 */
export async function loadPostgresAuthState(accountId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
}> {
  const read = async (type: string, keyId: string) => {
    const row = await db.baileysAuthKey.findUnique({ where: { accountId_type_keyId: { accountId, type, keyId } } });
    return row ? JSON.parse(decrypt(row.value), BufferJSON.reviver) : null;
  };
  const write = async (type: string, keyId: string, value: unknown) => {
    const stored = encrypt(JSON.stringify(value, BufferJSON.replacer));
    await db.baileysAuthKey.upsert({
      where: { accountId_type_keyId: { accountId, type, keyId } },
      create: { accountId, type, keyId, value: stored },
      update: { value: stored },
    });
  };
  const remove = (type: string, keyId: string) => db.baileysAuthKey.deleteMany({ where: { accountId, type, keyId } });

  const creds: AuthenticationCreds = (await read("creds", "creds")) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const rows = await db.baileysAuthKey.findMany({ where: { accountId, type, keyId: { in: ids } } });
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const row of rows) {
            let value = JSON.parse(decrypt(row.value), BufferJSON.reviver);
            if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[row.keyId] = value;
          }
          return out;
        },
        set: async (data) => {
          const tasks: Promise<unknown>[] = [];
          for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            for (const [keyId, value] of Object.entries(data[type] ?? {})) {
              tasks.push(value ? write(type, keyId, value) : remove(type, keyId));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write("creds", "creds", creds),
    clear: async () => {
      await db.baileysAuthKey.deleteMany({ where: { accountId } });
    },
  };
}
