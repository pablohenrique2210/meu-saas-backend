export type ProgressStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type EvaluationGameType = 'DILEMA' | 'INSPECAO' | 'CORRIDA';

export interface EvaluationResultReport {
  gameType: EvaluationGameType;
  finalScore: number;
  timeSpentSeconds: number;
  completedAt: string;
}

export interface ModuleEvaluationReport {
  gameType: EvaluationGameType;
  completedCount: number;
  participationRate: number;
  averageScore: number;
  averageTimeSpentSeconds: number;
}

export interface LessonReport {
  id: string;
  title: string;
  order: number;
  type: string;
  durationMinutes: number;
  startedCount: number;
  completedCount: number;
  completionRate: number;
}

export interface ModuleReport {
  id: string;
  title: string;
  order: number;
  totalLessons: number;
  averageProgress: number;
  completionRate: number;
  evaluation: ModuleEvaluationReport | null;
  lessons: LessonReport[];
}

export interface CollaboratorModuleReport {
  moduleId: string;
  title: string;
  completedLessons: number;
  totalLessons: number;
  progress: number;
  status: ProgressStatus;
  evaluation: EvaluationResultReport | null;
}

export interface CollaboratorReport {
  id: string;
  name: string;
  email: string;
  position: string | null;
  department: string | null;
  isActive: boolean;
  completedLessons: number;
  totalLessons: number;
  overallProgress: number;
  status: ProgressStatus;
  lastActivity: string | null;
  modules: CollaboratorModuleReport[];
}

export interface CourseProgressReport {
  generatedAt: string;
  company: { id: string; name: string };
  course: {
    id: string;
    title: string;
    description: string | null;
    category: string;
    author: string | null;
  };
  summary: {
    collaboratorsAssigned: number;
    collaboratorsStarted: number;
    collaboratorsCompleted: number;
    averageProgress: number;
    completionRate: number;
    totalModules: number;
    totalLessons: number;
    totalEstimatedMinutes: number;
    evaluationsConfigured: number;
    evaluationsCompleted: number;
    evaluationParticipationRate: number;
    averageEvaluationScore: number;
  };
  modules: ModuleReport[];
  collaborators: CollaboratorReport[];
  insights: string[];
}
