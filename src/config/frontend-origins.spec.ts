import {
  getClerkAuthorizedParties,
  isAllowedFrontendOrigin,
} from './frontend-origins';

describe('frontend origins', () => {
  const originalFrontendUrls = process.env.FRONTEND_URLS;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalVercelProjects = process.env.VERCEL_FRONTEND_PROJECTS;
  const originalAuthorizedParties = process.env.CLERK_AUTHORIZED_PARTIES;

  afterEach(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('FRONTEND_URLS', originalFrontendUrls);
    restore('FRONTEND_URL', originalFrontendUrl);
    restore('VERCEL_FRONTEND_PROJECTS', originalVercelProjects);
    restore('CLERK_AUTHORIZED_PARTIES', originalAuthorizedParties);
  });

  it('allows the configured frontend and project preview domains', () => {
    process.env.FRONTEND_URLS = 'https://app.example.com,http://localhost:3000';
    process.env.VERCEL_FRONTEND_PROJECTS =
      'pablohenrique2210-meu-saas-frontend';

    expect(isAllowedFrontendOrigin('https://app.example.com')).toBe(true);
    expect(
      isAllowedFrontendOrigin(
        'https://pablohenrique2210-meu-saas-frontend-f7wskxj3i.vercel.app',
      ),
    ).toBe(true);
  });

  it('rejects unrelated, insecure or lookalike origins', () => {
    process.env.VERCEL_FRONTEND_PROJECTS =
      'pablohenrique2210-meu-saas-frontend';

    expect(isAllowedFrontendOrigin('https://attacker.vercel.app')).toBe(false);
    expect(
      isAllowedFrontendOrigin(
        'http://pablohenrique2210-meu-saas-frontend-test.vercel.app',
      ),
    ).toBe(false);
    expect(
      isAllowedFrontendOrigin(
        'https://pablohenrique2210-meu-saas-frontend.example.com',
      ),
    ).toBe(false);
  });

  it('adds an allowed preview origin to Clerk authorized parties', () => {
    process.env.CLERK_AUTHORIZED_PARTIES = 'http://localhost:3000';
    process.env.VERCEL_FRONTEND_PROJECTS =
      'pablohenrique2210-meu-saas-frontend';
    const preview =
      'https://pablohenrique2210-meu-saas-frontend-f7wskxj3i.vercel.app';

    expect(getClerkAuthorizedParties(preview)).toEqual([
      'http://localhost:3000',
      preview,
    ]);
  });
});
