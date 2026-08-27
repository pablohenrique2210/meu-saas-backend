const splitList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/$/, '');
}

export function getFrontendOrigins() {
  return splitList(
    process.env.FRONTEND_URLS ??
      process.env.FRONTEND_URL ??
      'http://localhost:3000',
  ).map(normalizeOrigin);
}

function getVercelFrontendProjects() {
  return splitList(
    process.env.VERCEL_FRONTEND_PROJECTS ??
      'pablohenrique2210-meu-saas-frontend,laconsultoria',
  ).map((project) => project.toLowerCase());
}

export function isAllowedVercelOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      hostname.endsWith('.vercel.app') &&
      getVercelFrontendProjects().some(
        (project) =>
          hostname === `${project}.vercel.app` ||
          hostname.startsWith(`${project}-`),
      )
    );
  } catch {
    return false;
  }
}

export function isAllowedFrontendOrigin(origin: string) {
  const normalizedOrigin = normalizeOrigin(origin);
  return (
    getFrontendOrigins().includes(normalizedOrigin) ||
    isAllowedVercelOrigin(normalizedOrigin)
  );
}

export function getClerkAuthorizedParties(requestOrigin?: string) {
  const configuredParties = splitList(
    process.env.CLERK_AUTHORIZED_PARTIES ?? getFrontendOrigins().join(','),
  ).map(normalizeOrigin);
  const normalizedRequestOrigin = requestOrigin
    ? normalizeOrigin(requestOrigin)
    : null;

  if (
    normalizedRequestOrigin &&
    isAllowedFrontendOrigin(normalizedRequestOrigin)
  ) {
    configuredParties.push(normalizedRequestOrigin);
  }

  return [...new Set(configuredParties)];
}
