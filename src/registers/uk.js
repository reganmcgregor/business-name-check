import { request } from '../http.js';

export const companiesHouse = {
  id: 'uk-companies-house',
  country: 'UK',
  kind: 'business',
  label: 'Companies House (UK company register)',
  env: ['COMPANIES_HOUSE_API_KEY'],
  signup: 'https://developer.company-information.service.gov.uk/',
  coverage: 'Companies and LLPs registered in England, Wales, Scotland and Northern Ireland. Sole traders and partnerships are not on this register.',
  async search(name, env, { limit }) {
    const url = new URL('https://api.company-information.service.gov.uk/search/companies');
    url.searchParams.set('q', name);
    url.searchParams.set('items_per_page', String(Math.min(Math.max(limit, 1), 100)));
    const auth = Buffer.from(`${env.COMPANIES_HOUSE_API_KEY}:`).toString('base64');
    const res = await request(url.toString(), { headers: { authorization: `Basic ${auth}` } });
    const body = res.json();
    return {
      total: body.total_results ?? (body.items ?? []).length,
      matches: (body.items ?? []).map((c) => ({
        name: c.title,
        status: c.company_status,
        active: ['dissolved', 'closed', 'converted-closed', 'removed'].includes(c.company_status) ? false : true,
        type: c.company_type,
        id: c.company_number,
        url: `https://find-and-update.company-information.service.gov.uk/company/${c.company_number}`,
        details: { created: c.date_of_creation, ceased: c.date_of_cessation, address: c.address_snippet },
      })),
    };
  },
};

export const ukManual = [
  { label: 'UK IPO trade mark search (no public API, captcha-protected)', url: () => 'https://trademarks.ipo.gov.uk/ipo-tmtext' },
];
