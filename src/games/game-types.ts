export const ModuleGameType = {
  DILEMA: 'DILEMA',
  INSPECAO: 'INSPECAO',
  CORRIDA: 'CORRIDA',
} as const;

export type ModuleGameType =
  (typeof ModuleGameType)[keyof typeof ModuleGameType];
