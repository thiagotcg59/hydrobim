/** Erro de domínio previsível (entrada inválida, operação não permitida etc.). */
export interface DomainError {
  /** Código estável, usado por testes e por tratamento programático. */
  readonly code: string;
  /** Mensagem em português, adequada para exibição ao usuário. */
  readonly message: string;
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});
