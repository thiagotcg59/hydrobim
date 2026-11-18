/**
 * Biblioteca de produtos: tabelas dimensionais transcritas dos catálogos, com as letras das
 * cotas como impressas (em MILÍMETROS). Diferente das famílias de conexões
 * (`families/`), que alimentam as operações de domínio, a biblioteca descreve o produto
 * completo para a modelagem 3D — inclusive peças que ainda não podem ser inseridas na rede.
 */

export type ProductShape =
  | 'pipe'
  | 'bend'
  | 'tee'
  | 'cross'
  | 'cap'
  | 'slipCoupling'
  | 'transitionCoupling'
  | 'reducer'
  | 'adapter'
  | 'saddle'
  | 'jeriSeal'
  | 'oRing';

export const PRODUCT_CATEGORIES = [
  'Tubos',
  'Curvas',
  'Tês e cruzetas',
  'Reduções',
  'Luvas e caps',
  'Adaptadores',
  'Colares de tomada',
  'Anéis de vedação',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export interface ProductColumn {
  /** Letra da cota na tabela do fabricante. */
  readonly key: string;
  /** Significado da cota no desenho do fabricante. */
  readonly title: string;
}

export interface ProductSize {
  /** Bitola como impressa na tabela. */
  readonly label: string;
  readonly dn: number;
  /** Segundo diâmetro nominal (derivação ou lado menor). */
  readonly dn2?: number;
  /** Código e descrição do produto no catálogo. */
  readonly code: string;
  readonly description: string;
  readonly weightG: number;
  /** Cotas em mm, pela letra da tabela. */
  readonly dims: Readonly<Record<string, number>>;
  /** Saída roscada (colar de tomada), em polegadas. */
  readonly thread?: '1/2' | '3/4';
}

export interface ProductFamily {
  readonly id: string;
  readonly name: string;
  readonly category: ProductCategory;
  readonly shape: ProductShape;
  /** Curvas: ângulo de deflexão em graus. */
  readonly angleDeg?: number;
  /** Tubos: classe de pressão. */
  readonly pressureClass?: 12 | 15 | 20;
  readonly manufacturer: string;
  readonly standard: string;
  /** Documento, edição, página e URL. */
  readonly source: string;
  /** O que NÃO vem da tabela: valores derivados, adotados ou de representação. */
  readonly approximations: readonly string[];
  /** Divergências encontradas no próprio catálogo (transcritas como impressas). */
  readonly remarks: readonly string[];
  /**
   * Situação na rede: `inserted` indica que o produto já é inserido pelas ferramentas do
   * editor; a nota diz como, ou em que fase a inserção está prevista.
   */
  readonly network: { readonly inserted: boolean; readonly note: string };
  readonly columns: readonly ProductColumn[];
  readonly sizes: readonly ProductSize[];
}
