import { request } from '../http.js';

export const nzbn = {
  id: 'nz-nzbn',
  country: 'NZ',
  kind: 'business',
  label: 'NZBN register (New Zealand Business Number)',
  env: ['NZBN_SUBSCRIPTION_KEY'],
  signup: 'https://portal.api.business.govt.nz/',
  coverage: 'All NZ companies, plus sole traders, partnerships and trusts that have an NZBN, including trading names.',
  async search(name, env, { limit }) {
    const base = env.NZBN_ENV === 'sandbox'
      ? 'https://api.business.govt.nz/sandbox/nzbn/v5'
      : 'https://api.business.govt.nz/gateway/nzbn/v5';
    const url = new URL(`${base}/entities`);
    url.searchParams.set('search-term', name);
    url.searchParams.set('page-size', String(Math.min(Math.max(limit, 1), 100)));
    const res = await request(url.toString(), {
      headers: { 'Ocp-Apim-Subscription-Key': env.NZBN_SUBSCRIPTION_KEY },
    });
    const body = res.json();
    return {
      total: body.totalItems ?? (body.items ?? []).length,
      matches: (body.items ?? []).map((e) => ({
        name: e.entityName,
        status: e.entityStatusDescription,
        type: e.entityTypeDescription,
        id: e.nzbn,
        url: `https://www.nzbn.govt.nz/mynzbn/nzbndetails/${e.nzbn}`,
        details: { sourceRegister: e.sourceRegister, tradingNames: (e.tradingNames ?? []).map((t) => t.name) },
      })),
    };
  },
};

export const nzManual = [
  {
    label: 'NZ Companies Register name search',
    url: (name) => `https://app.companiesoffice.govt.nz/companies/app/ui/pages/companies/search?q=${encodeURIComponent(name)}&entityTypes=ALL&entityStatusGroups=ALL`,
  },
  { label: 'IPONZ trade mark search (API exists but is not scripted here)', url: () => 'https://app.iponz.govt.nz/app/Extra/IP/TM/Qbe.aspx' },
];
