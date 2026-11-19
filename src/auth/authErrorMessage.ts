/** Never expose server diagnostics, credentials or tokens in the interface. */
export function authErrorMessage(error: unknown): string {
  const detail =
    error && typeof error === "object"
      ? (error as {
          code?: string;
          name?: string;
          message?: string;
          status?: number;
        })
      : {};
  const message = detail.message?.toLowerCase() ?? "";

  if (
    detail.code === "session_changed" ||
    message ===
      "sua sessão mudou. abra novamente o link de recuperação para continuar."
  )
    return "Sua sessão mudou. Abra novamente o link de recuperação para continuar.";

  if (
    detail.name === "AuthRetryableFetchError" ||
    detail.name === "TypeError" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("load failed") ||
    (detail.status !== undefined && detail.status >= 500)
  ) {
    return "Não foi possível conectar ao serviço de autenticação. Verifique sua conexão e tente novamente. Se persistir, contate o responsável pelo sistema.";
  }

  switch (detail.code) {
    case "invalid_credentials":
      return "E-mail ou senha incorretos.";
    case "email_not_confirmed":
      return "Confirme seu e-mail pelo link recebido antes de entrar.";
    case "over_email_send_rate_limit":
      return "O limite de envio de e-mails foi atingido. Aguarde e tente novamente ou contate o administrador do sistema.";
    case "over_request_rate_limit":
      return "Muitas tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.";
    case "weak_password":
      return "Escolha uma senha mais forte, com pelo menos 10 caracteres.";
    case "signup_disabled":
      return "O cadastro está indisponível no momento. Contate o administrador do sistema.";
    case "user_already_exists":
    case "email_exists":
      return "Não foi possível concluir o cadastro com esses dados. Se já possui uma conta, tente entrar.";
    case "email_address_invalid":
    case "validation_failed":
      return "Verifique se os dados informados são válidos.";
    case "captcha_failed":
      return "A verificação de segurança não foi concluída. Contate o administrador para verificar a configuração do formulário.";
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "session_not_found":
      return "Sua sessão expirou. Entre novamente para continuar.";
    case "otp_expired":
    case "otp_disabled":
    case "bad_code_verifier":
    case "flow_state_not_found":
    case "flow_state_expired":
    case "pkce_verifier_not_found":
      return "O link de acesso é inválido ou expirou. Solicite um novo link e abra-o no mesmo navegador.";
    case "same_password":
      return "Escolha uma senha diferente da senha atual.";
    case "provider_disabled":
    case "oauth_provider_not_supported":
      return "O acesso com Google não está disponível. Use e-mail e senha ou contate o responsável pelo sistema.";
    default:
      return "Não foi possível concluir a autenticação. Tente novamente em alguns instantes.";
  }
}
