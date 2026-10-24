/**
 * The product's name, decided in UX Phase 8: "Fimmick AISO", made by the
 * company Fimmick. A proper noun, the same in every language, so it lives
 * here rather than in messages/. The text audit fails on any other name.
 */
export const BRAND = { company: 'Fimmick', product: 'AISO' } as const
export const PRODUCT_NAME = `${BRAND.company} ${BRAND.product}` as const
