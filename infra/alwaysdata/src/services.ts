import type { AlwaysdataApi, Resource } from "./api.ts";
import type { EnvironmentName } from "./environments.ts";
import { serviceAnnotation, serviceDisabledField, type ServiceProgram } from "./resources.ts";

export type Services = { api: Resource; worker: Resource };

const programs: ServiceProgram[] = ["api", "worker"];

/** The API and worker services of an environment, found by their annotation. */
export async function findServices(api: AlwaysdataApi, env: EnvironmentName): Promise<Services> {
  const all = await api.list("service");
  const found: Partial<Services> = {};
  const problems: string[] = [];
  for (const program of programs) {
    const annotation = serviceAnnotation(program, env);
    const matches = all.filter((service) => service.annotation === annotation);
    if (matches.length === 1) found[program] = matches[0];
    else if (matches.length === 0) problems.push(`Found no service "${annotation}".`);
    else problems.push(`Found ${matches.length} services "${annotation}"; expected one.`);
  }
  if (!found.api || !found.worker) {
    throw new Error(
      `${problems.join(" ")} Run pnpm infra:provision --environment ${env} to see what differs.`,
    );
  }
  return { api: found.api, worker: found.worker };
}

/** Turns both services of an environment on or off. */
export async function setServicesEnabled(
  api: AlwaysdataApi,
  env: EnvironmentName,
  enabled: boolean,
): Promise<Services> {
  const services = await findServices(api, env);
  for (const service of [services.api, services.worker]) {
    await api.update("service", service.id, { [serviceDisabledField]: !enabled });
  }
  return services;
}

/**
 * Reads the services of an environment again and turns on those that are off. Alwaysdata
 * switches a service off after repeated quick failures (a crash-looping release), so this runs
 * before every restart, also in a rollback. Returns the services and the annotations of the
 * ones it turned on.
 */
export async function enableDisabledServices(
  api: AlwaysdataApi,
  env: EnvironmentName,
): Promise<{ services: Services; enabled: string[] }> {
  const services = await findServices(api, env);
  const enabled: string[] = [];
  for (const service of [services.api, services.worker]) {
    if (service[serviceDisabledField] === true) {
      await api.update("service", service.id, { [serviceDisabledField]: false });
      enabled.push(String(service.annotation));
    }
  }
  return { services, enabled };
}

/**
 * Restarts the API, then the worker. Returns the time just before the worker's restart: a
 * worker heartbeat after it comes from the restarted worker.
 */
export async function restartServices(
  api: AlwaysdataApi,
  services: Services,
  now: () => Date = () => new Date(),
): Promise<Date> {
  await api.restartService(services.api.id);
  const workerRestartedAt = now();
  await api.restartService(services.worker.id);
  return workerRestartedAt;
}
