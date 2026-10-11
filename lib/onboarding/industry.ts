import type {IndustryCode} from '@/lib/types'
export const INDUSTRY_CODES:readonly IndustryCode[]=['finance','medical','legal','technology','retail_ecommerce','travel_hospitality','education','real_estate','manufacturing','media_entertainment','energy_utilities','general_b2b','general_b2c']
const legacy:Record<string,IndustryCode>={'Marketing & Advertising':'general_b2b',Technology:'technology','Finance & Banking':'finance',Healthcare:'medical','Retail & E-commerce':'retail_ecommerce','Real Estate':'real_estate',Education:'education',Other:'general_b2c'}
export function readIndustry(value:string|null):IndustryCode|null {return value&&(INDUSTRY_CODES as readonly string[]).includes(value)?value as IndustryCode:value?legacy[value]??null:null}
