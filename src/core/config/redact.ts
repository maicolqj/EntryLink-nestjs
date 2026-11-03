/**
 * «with value "secreto"» → «with value "[redactado]"». Los validadores (Joi)
 * ponen el valor rechazado en el mensaje; ningún mensaje que vaya a logs o a
 * Sentry debe llevarlo.
 */
export function redactValues(text: string): string {
  return text.replace(
    /(with value )(["'])(?:(?!\2).)*\2/g,
    '$1$2[redactado]$2',
  );
}
