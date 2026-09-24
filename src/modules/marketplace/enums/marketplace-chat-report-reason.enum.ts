import { registerEnumType } from '@nestjs/graphql';

/** Por qué se reporta una conversación del chat. */
export enum MarketplaceChatReportReason {
  HARASSMENT = 'HARASSMENT',
  SCAM = 'SCAM',
  OFFENSIVE = 'OFFENSIVE',
  SPAM = 'SPAM',
  OTHER = 'OTHER',
}

registerEnumType(MarketplaceChatReportReason, {
  name: 'MarketplaceChatReportReason',
  description: 'Motivo del reporte de una conversación',
  valuesMap: {
    HARASSMENT: { description: 'Acoso o insistencia después de un "no"' },
    SCAM: { description: 'Parece una estafa' },
    OFFENSIVE: { description: 'Lenguaje ofensivo o amenazas' },
    SPAM: { description: 'Mensajes repetidos o publicidad' },
    OTHER: { description: 'Otro motivo' },
  },
});

/** Qué hace la administración con una conversación reportada. */
export enum MarketplaceChatReportAction {
  DISMISS = 'DISMISS',
  CLOSE_CONVERSATION = 'CLOSE_CONVERSATION',
}

registerEnumType(MarketplaceChatReportAction, {
  name: 'MarketplaceChatReportAction',
  description: 'Resolución de un reporte de conversación',
  valuesMap: {
    DISMISS: { description: 'No procede: la conversación sigue abierta' },
    CLOSE_CONVERSATION: {
      description: 'Procede: la conversación queda cerrada para los dos',
    },
  },
});
