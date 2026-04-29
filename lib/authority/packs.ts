import type { IndustryCode, RegionCode } from '@/lib/types'

export interface IndustryPack {
  code:             IndustryCode
  displayName:      string
  multiplier:       number
  authorityDomains: { tier1: string[]; tier2: string[]; tier3: string[] }
  topicalKeywords:  string[]
}

export interface RegionalPack {
  code:        RegionCode
  displayName: string
  tier1Local:  string[]
  tier2Local:  string[]
  tier3Local:  string[]
  community:   string[]
}

export const INDUSTRY_PACKS: Record<IndustryCode, IndustryPack> = {
  finance: {
    code: 'finance', displayName: 'Finance & Banking', multiplier: 1.5,
    authorityDomains: {
      tier1: ['bloomberg.com','reuters.com','ft.com','wsj.com','sec.gov','federalreserve.gov','bis.org'],
      tier2: ['investopedia.com','morningstar.com','seekingalpha.com','marketwatch.com','fool.com'],
      tier3: ['bankrate.com','nerdwallet.com','thebalance.com'],
    },
    topicalKeywords: ['interest rate','portfolio','asset management','equity','bond','inflation','hedge fund'],
  },
  medical: {
    code: 'medical', displayName: 'Healthcare & Medical', multiplier: 2.0,
    authorityDomains: {
      tier1: ['nih.gov','who.int','cdc.gov','pubmed.ncbi.nlm.nih.gov','nejm.org','thelancet.com','bmj.com','jamanetwork.com'],
      tier2: ['mayoclinic.org','clevelandclinic.org','webmd.com','medlineplus.gov','healthline.com'],
      tier3: ['drugs.com','rxlist.com','emedicinehealth.com'],
    },
    topicalKeywords: ['clinical trial','diagnosis','treatment','evidence-based','meta-analysis','randomized controlled trial'],
  },
  legal: {
    code: 'legal', displayName: 'Legal & Compliance', multiplier: 1.8,
    authorityDomains: {
      tier1: ['law.cornell.edu','supremecourt.gov','justice.gov','eur-lex.europa.eu','legislation.gov.uk'],
      tier2: ['findlaw.com','justia.com','nolo.com','avvo.com','legal.thomsonreuters.com'],
      tier3: ['lawyers.com','martindale.com'],
    },
    topicalKeywords: ['statute','regulation','precedent','compliance','jurisdiction','liability','contract'],
  },
  technology: {
    code: 'technology', displayName: 'Technology', multiplier: 1.2,
    authorityDomains: {
      tier1: ['arxiv.org','ieee.org','acm.org','github.com','stackoverflow.com','w3.org','ietf.org'],
      tier2: ['techcrunch.com','wired.com','arstechnica.com','hbr.org','infoq.com'],
      tier3: ['zdnet.com','tomsguide.com','pcmag.com'],
    },
    topicalKeywords: ['open source','API','machine learning','cloud computing','cybersecurity','microservices'],
  },
  retail_ecommerce: {
    code: 'retail_ecommerce', displayName: 'Retail & E-Commerce', multiplier: 1.0,
    authorityDomains: {
      tier1: ['amazon.com','shopify.com','nrf.com','census.gov'],
      tier2: ['emarketer.com','digitalcommerce360.com','retaildive.com'],
      tier3: ['bigcommerce.com','woocommerce.com'],
    },
    topicalKeywords: ['conversion rate','cart abandonment','SKU','supply chain','omnichannel'],
  },
  travel_hospitality: {
    code: 'travel_hospitality', displayName: 'Travel & Hospitality', multiplier: 1.0,
    authorityDomains: {
      tier1: ['tripadvisor.com','booking.com','unwto.org','iata.org'],
      tier2: ['skyscanner.com','kayak.com','hotels.com','airbnb.com'],
      tier3: ['travelandleisure.com','lonelyplanet.com'],
    },
    topicalKeywords: ['occupancy rate','RevPAR','ADR','GDS','package tour'],
  },
  education: {
    code: 'education', displayName: 'Education', multiplier: 1.3,
    authorityDomains: {
      tier1: ['mit.edu','stanford.edu','harvard.edu','ed.gov','unesco.org','khanacademy.org'],
      tier2: ['coursera.org','edx.org','mooc.org','jstor.org','eric.ed.gov'],
      tier3: ['teacherspayteachers.com'],
    },
    topicalKeywords: ['curriculum','pedagogy','accreditation','learning outcome','EdTech','STEM'],
  },
  real_estate: {
    code: 'real_estate', displayName: 'Real Estate', multiplier: 1.1,
    authorityDomains: {
      tier1: ['nar.realtor','zillow.com','hud.gov','freddiemac.com','fanniemae.com'],
      tier2: ['realtor.com','redfin.com','homes.com','costar.com'],
      tier3: ['trulia.com','movoto.com'],
    },
    topicalKeywords: ['cap rate','NOI','vacancy rate','MLS','REIT','1031 exchange'],
  },
  manufacturing: {
    code: 'manufacturing', displayName: 'Manufacturing & Industrial', multiplier: 1.1,
    authorityDomains: {
      tier1: ['asme.org','iso.org','nist.gov','nam.org','epa.gov'],
      tier2: ['industryweek.com','manufacturingtomorrow.com','thomasnet.com'],
      tier3: ['mfgtechupdate.com'],
    },
    topicalKeywords: ['lean manufacturing','Six Sigma','ISO 9001','supply chain','OEE','CNC'],
  },
  media_entertainment: {
    code: 'media_entertainment', displayName: 'Media & Entertainment', multiplier: 1.0,
    authorityDomains: {
      tier1: ['variety.com','hollywoodreporter.com','billboard.com','deadline.com'],
      tier2: ['rottentomatoes.com','imdb.com','metacritic.com','spotify.com'],
      tier3: ['digitalspy.com','screenrant.com'],
    },
    topicalKeywords: ['streaming','IP','box office','subscriber','licensing','syndication'],
  },
  energy_utilities: {
    code: 'energy_utilities', displayName: 'Energy & Utilities', multiplier: 1.3,
    authorityDomains: {
      tier1: ['iea.org','eia.gov','energy.gov','irena.org','worldbank.org'],
      tier2: ['energymonitor.ai','pv-tech.org','renewableenergyworld.com'],
      tier3: ['utilitydive.com','power-technology.com'],
    },
    topicalKeywords: ['renewable energy','grid','kWh','carbon emission','LCOE','net zero'],
  },
  general_b2b: {
    code: 'general_b2b', displayName: 'General B2B', multiplier: 1.0,
    authorityDomains: {
      tier1: ['gartner.com','mckinsey.com','deloitte.com','hbr.org','bcg.com'],
      tier2: ['forrester.com','idc.com','g2.com','capterra.com'],
      tier3: ['businesswire.com','prnewswire.com'],
    },
    topicalKeywords: ['ROI','SaaS','enterprise','B2B','procurement','whitepaper'],
  },
  general_b2c: {
    code: 'general_b2c', displayName: 'General B2C', multiplier: 1.0,
    authorityDomains: {
      tier1: ['consumer.ftc.gov','consumerreports.org','bbc.com','nytimes.com'],
      tier2: ['reddit.com','quora.com','trustpilot.com','wirecutter.com'],
      tier3: ['buzzfeed.com','reviewed.com'],
    },
    topicalKeywords: ['review','comparison','best','affordable','how to','guide'],
  },
}

export const REGIONAL_PACKS: Record<RegionCode, RegionalPack> = {
  HK: {
    code: 'HK', displayName: 'Hong Kong',
    tier1Local: ['hkma.gov.hk','judiciary.hk','legco.gov.hk','hkex.com.hk'],
    tier2Local: ['scmp.com','hkfp.com','thestandard.com.hk'],
    tier3Local: ['hk01.com','edigest.hk'],
    community: ['reddit.com'],
  },
  TW: {
    code: 'TW', displayName: 'Taiwan',
    tier1Local: ['president.gov.tw','cbc.gov.tw','twse.com.tw','mohw.gov.tw'],
    tier2Local: ['cna.com.tw','udn.com','chinatimes.com'],
    tier3Local: ['ltn.com.tw','ettoday.net'],
    community: ['ptt.cc'],
  },
  SG: {
    code: 'SG', displayName: 'Singapore',
    tier1Local: ['gov.sg','mas.gov.sg','moh.gov.sg','sgx.com'],
    tier2Local: ['straitstimes.com','channelnewsasia.com','businesstimes.com.sg'],
    tier3Local: ['todayonline.com','mothership.sg'],
    community: ['reddit.com'],
  },
  JP: {
    code: 'JP', displayName: 'Japan',
    tier1Local: ['japan.go.jp','boj.or.jp','fsa.go.jp','nhk.or.jp'],
    tier2Local: ['japantimes.co.jp','asahi.com','yomiuri.co.jp'],
    tier3Local: ['mainichi.jp'],
    community: ['reddit.com'],
  },
  KR: {
    code: 'KR', displayName: 'South Korea',
    tier1Local: ['korea.kr','bok.or.kr','fss.or.kr','krx.co.kr'],
    tier2Local: ['koreaherald.com','koreatimes.co.kr'],
    tier3Local: ['hani.co.kr'],
    community: ['reddit.com'],
  },
  US: {
    code: 'US', displayName: 'United States',
    tier1Local: ['whitehouse.gov','congress.gov','usa.gov','federalreserve.gov','cdc.gov'],
    tier2Local: ['nytimes.com','washingtonpost.com','wsj.com','apnews.com'],
    tier3Local: ['usatoday.com','nbcnews.com'],
    community: ['reddit.com','quora.com'],
  },
  UK: {
    code: 'UK', displayName: 'United Kingdom',
    tier1Local: ['gov.uk','bankofengland.co.uk','nhs.uk','parliament.uk'],
    tier2Local: ['bbc.co.uk','theguardian.com','ft.com'],
    tier3Local: ['telegraph.co.uk','independent.co.uk'],
    community: ['reddit.com'],
  },
  EU: {
    code: 'EU', displayName: 'European Union',
    tier1Local: ['europa.eu','ecb.europa.eu','europarl.europa.eu','eur-lex.europa.eu'],
    tier2Local: ['euronews.com','politico.eu','euractiv.com'],
    tier3Local: ['eubusiness.com'],
    community: ['reddit.com'],
  },
  AU: {
    code: 'AU', displayName: 'Australia',
    tier1Local: ['australia.gov.au','rba.gov.au','abs.gov.au','asx.com.au'],
    tier2Local: ['abc.net.au','smh.com.au','afr.com'],
    tier3Local: ['news.com.au'],
    community: ['reddit.com'],
  },
  CA: {
    code: 'CA', displayName: 'Canada',
    tier1Local: ['canada.ca','bankofcanada.ca','statcan.gc.ca'],
    tier2Local: ['globeandmail.com','nationalpost.com','cbc.ca'],
    tier3Local: ['ctvnews.ca'],
    community: ['reddit.com'],
  },
  global: {
    code: 'global', displayName: 'Global',
    tier1Local: ['un.org','worldbank.org','imf.org','wto.org','who.int'],
    tier2Local: ['reuters.com','bloomberg.com','apnews.com','economist.com'],
    tier3Local: ['bbc.com'],
    community: ['reddit.com','quora.com'],
  },
}
