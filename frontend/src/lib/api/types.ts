/**
 * Domain aliases over the generated OpenAPI types.
 *
 * Components import from here rather than reaching into `schema.d.ts`, so
 * regenerating the schema surfaces breakages in one place.
 */
import type { components } from './schema'

export type Company = components['schemas']['CompanyOut']
export type Price = components['schemas']['PriceOut']
export type Quote = components['schemas']['QuoteOut']
export type Note = components['schemas']['NoteOut']
export type NoteCreate = components['schemas']['NoteCreate']
export type NoteUpdate = components['schemas']['NoteUpdate']
export type AiQueryResponse = components['schemas']['AIQueryResponse']
