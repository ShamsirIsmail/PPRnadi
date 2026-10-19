import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TestHarnessHooks {
  beforeStorageUpload?: (candidate: { storagePath: string; buffer: Buffer; mimeType: string }) => Promise<void>;
  afterStorageUploadConflict?: (storagePath: string, error: unknown) => void;
  beforeMetadataInsert?: (candidate: {
    reportId: string;
    storagePath: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }) => Promise<void>;
  afterMetadataConflict?: (storagePath: string, error: unknown) => void;
  simulateCountQueryError?: boolean;
  simulateIncidentReportReadError?: boolean;
  simulateEvaluationsReadError?: boolean;
  simulateDecisionsReadError?: boolean;
  simulateLinksReadError?: boolean;
  simulateRpcWriteError?: boolean;
  simulateDbInsertError?: boolean;
}

export interface CookieAdapter {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (cookiesToSet: Array<{ name: string; value: string; options?: unknown }>) => void;
  testHooks?: TestHarnessHooks;
}

export const testSessionStorage = new AsyncLocalStorage<CookieAdapter>();

export function createAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin configuration missing (SUPABASE_SERVICE_ROLE_KEY).');
  }

  const rawClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const testStore = testSessionStorage.getStore();
  if (!testStore?.testHooks) {
    return rawClient;
  }

  const hooks = testStore.testHooks;
  if (hooks.simulateDbInsertError) {
    const originalFrom = rawClient.from.bind(rawClient);
    return new Proxy(rawClient, {
      get(target, prop, receiver) {
        if (prop === 'from') {
          return (tableName: string) => {
            const queryBuilder = originalFrom(tableName);
            if (tableName === 'report_priority_evaluations') {
              return new Proxy(queryBuilder, {
                get(qTarget, qProp, qReceiver) {
                  if (qProp === 'insert') {
                    return () => ({
                      select: () => ({
                        single: async () => ({
                          data: null,
                          error: { message: 'Simulated database insert failure on report_priority_evaluations' },
                        }),
                      }),
                    });
                  }
                  return Reflect.get(qTarget, qProp, qReceiver);
                },
              });
            }
            return queryBuilder;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  return rawClient;
}

export async function createServerSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured. Authentication and persistence are unavailable.');
  }

  const testStore = testSessionStorage.getStore();
  if (testStore) {
    const rawClient = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: testStore,
    });

    if (!testStore.testHooks) {
      return rawClient;
    }

    const hooks = testStore.testHooks;
    const originalFrom = rawClient.from.bind(rawClient);
    const originalStorageFrom = rawClient.storage.from.bind(rawClient.storage);

    return new Proxy(rawClient, {
      get(target, prop, receiver) {
        if (prop === 'storage') {
          return new Proxy(target.storage, {
            get(sTarget, sProp, sReceiver) {
              if (sProp === 'from') {
                return (bucketId: string) => {
                  const storageBucket = originalStorageFrom(bucketId);
                  const origUpload = storageBucket.upload.bind(storageBucket);
                  return new Proxy(storageBucket, {
                    get(bTarget, bProp, bReceiver) {
                      if (bProp === 'upload') {
                        return async (
                          path: string,
                          fileBody: string | ArrayBuffer | ArrayBufferView | Buffer | Blob | File | FormData,
                          fileOptions?: { contentType?: string; upsert?: boolean }
                        ) => {
                          if (hooks.beforeStorageUpload) {
                            const buf = Buffer.isBuffer(fileBody)
                              ? fileBody
                              : Buffer.from(fileBody as ArrayBuffer);
                            await hooks.beforeStorageUpload({
                              storagePath: path,
                              buffer: buf,
                              mimeType: fileOptions?.contentType || 'image/png',
                            });
                          }
                          const result = await origUpload(path, fileBody, fileOptions);
                          if (result.error && hooks.afterStorageUploadConflict) {
                            hooks.afterStorageUploadConflict(path, result.error);
                          }
                          return result;
                        };
                      }
                      return Reflect.get(bTarget, bProp, bReceiver);
                    },
                  });
                };
              }
              return Reflect.get(sTarget, sProp, sReceiver);
            },
          });
        }

        if (prop === 'rpc' && hooks.simulateRpcWriteError) {
          return async () => ({
            data: null,
            error: { message: 'Simulated database RPC write failure' },
          });
        }

        if (prop === 'from') {
          return (tableName: string) => {
            const queryBuilder = (originalFrom as (table: string) => ReturnType<typeof originalFrom>)(tableName);

            if (tableName === 'incident_reports' && hooks.simulateIncidentReportReadError) {
              const errObj = {
                select: () => errObj,
                eq: () => errObj,
                maybeSingle: async () => ({
                  data: null,
                  error: { message: 'Simulated database read failure on incident_reports' },
                }),
                single: async () => ({
                  data: null,
                  error: { message: 'Simulated database read failure on incident_reports' },
                }),
              };
              return errObj;
            }

            if (tableName === 'report_priority_evaluations' && hooks.simulateEvaluationsReadError) {
              const errObj = {
                select: () => errObj,
                eq: () => errObj,
                in: () => errObj,
                order: () => errObj,
                limit: () => errObj,
                maybeSingle: async () => ({
                  data: null,
                  error: { message: 'Simulated database read failure on report_priority_evaluations' },
                }),
                then: (resolve: (v: unknown) => void) =>
                  resolve({
                    data: null,
                    error: { message: 'Simulated database read failure on report_priority_evaluations' },
                  }),
              };
              return errObj;
            }

            if (tableName === 'incident_report_links' && hooks.simulateLinksReadError) {
              const errObj = {
                select: () => errObj,
                eq: () => errObj,
                in: () => errObj,
                maybeSingle: async () => ({
                  data: null,
                  error: { message: 'Simulated database read failure on incident_report_links' },
                }),
                then: (resolve: (v: unknown) => void) =>
                  resolve({
                    data: null,
                    error: { message: 'Simulated database read failure on incident_report_links' },
                  }),
              };
              return errObj;
            }

            if (tableName === 'report_priority_decisions' && hooks.simulateDecisionsReadError) {
              const errObj = {
                select: () => errObj,
                eq: () => errObj,
                in: () => errObj,
                order: () => errObj,
                limit: () => errObj,
                maybeSingle: async () => ({
                  data: null,
                  error: { message: 'Simulated database read failure on report_priority_decisions' },
                }),
                then: (resolve: (v: unknown) => void) =>
                  resolve({
                    data: null,
                    error: { message: 'Simulated database read failure on report_priority_decisions' },
                  }),
              };
              return errObj;
            }

            if (tableName === 'report_attachments') {
              const origInsert = queryBuilder.insert.bind(queryBuilder);
              const origSelect = queryBuilder.select.bind(queryBuilder);

              return new Proxy(queryBuilder, {
                get(qTarget, qProp, qReceiver) {
                  if (qProp === 'insert') {
                    return async (values: unknown, options?: unknown) => {
                      const candidate = (Array.isArray(values) ? values[0] : values) as
                        | Record<string, unknown>
                        | undefined;
                      if (hooks.beforeMetadataInsert && candidate) {
                        await hooks.beforeMetadataInsert({
                          reportId: String(candidate.report_id || ''),
                          storagePath: String(candidate.storage_path || ''),
                          fileName: String(candidate.file_name || ''),
                          mimeType: String(candidate.mime_type || ''),
                          fileSize: Number(candidate.file_size_bytes || 0),
                        });
                      }
                      const result = await (origInsert as unknown as (v: unknown, o?: unknown) => Promise<{ error: unknown }>)(
                        values,
                        options
                      );
                      if (result.error && hooks.afterMetadataConflict && candidate) {
                        hooks.afterMetadataConflict(String(candidate.storage_path || ''), result.error);
                      }
                      return result;
                    };
                  }
                  if (qProp === 'select') {
                    return (...args: unknown[]) => {
                      const selectBuilder = (origSelect as (...a: unknown[]) => ReturnType<typeof origSelect>)(
                        ...args
                      );
                      const countOptions = args[1] as { count?: string } | undefined;
                      const isCountQuery = Boolean(countOptions?.count === 'exact');
                      if (hooks.simulateCountQueryError && isCountQuery) {
                        return new Proxy(selectBuilder, {
                          get(sTarget, sProp, sReceiver) {
                            if (sProp === 'eq') {
                              return async () => {
                                return {
                                  data: null,
                                  count: null,
                                  error: { message: 'Simulated database count verification failure' },
                                };
                              };
                            }
                            return Reflect.get(sTarget, sProp, sReceiver);
                          },
                        });
                      }
                      return selectBuilder;
                    };
                  }
                  return Reflect.get(qTarget, qProp, qReceiver);
                },
              });
            }
            return queryBuilder;
          };
        }

        return Reflect.get(target, prop, receiver);
      },
    });
  }


  try {
    await connection();
  } catch (err: unknown) {
    if (!(err instanceof Error && err.message.includes('outside a request scope'))) {
      throw err;
    }
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing user sessions.
        }
      },
    },
  });
}
