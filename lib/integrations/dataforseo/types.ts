export type DataForSeoFailureKind =
  | 'unavailable'
  | 'auth'
  | 'payment'
  | 'rate_limit'
  | 'invalid'
  | 'misconfigured'

export type DataForSeoCredentials = {
  login: string
  credential: string
}

export type DataForSeoConfig = DataForSeoCredentials & {
  locationCode: number
  languageCode: string
}

export type DataForSeoOrganicItem = {
  rank: number
  title: string
  url: string
  domain?: string
}

export type DataForSeoOrganicResult = {
  items: DataForSeoOrganicItem[]
  statusCode: number
  statusMessage?: string
}

export class DataForSeoError extends Error {
  readonly kind: DataForSeoFailureKind
  readonly httpStatus: number
  readonly code?: number

  constructor(kind: DataForSeoFailureKind, httpStatus: number, message: string, code?: number) {
    super(message)
    this.name = 'DataForSeoError'
    this.kind = kind
    this.httpStatus = httpStatus
    this.code = code
  }
}
