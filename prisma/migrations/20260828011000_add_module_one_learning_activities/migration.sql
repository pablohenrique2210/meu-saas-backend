-- Substitui as perguntas provisórias do primeiro módulo pelas atividades
-- fornecidas para o Programa Líder em Ação.
UPDATE "Module" AS module
SET
  "gameType" = 'CORRIDA'::"ModuleGameType",
  "gameConfig" = $activities$
  {
    "questions": [
      {
        "id": "autoconhecimento-1",
        "sectionTitle": "Quiz 1 — Autoconhecimento na Liderança",
        "prompt": "Qual é a principal finalidade do autoconhecimento na liderança?",
        "options": [
          { "id": "a", "label": "Identificar apenas os pontos fortes do líder." },
          { "id": "b", "label": "Evitar que o líder receba críticas da equipe." },
          { "id": "c", "label": "Reconhecer comportamentos, padrões, forças e oportunidades de desenvolvimento." },
          { "id": "d", "label": "Garantir que o líder tome todas as decisões sozinho." }
        ],
        "correctOptionId": "c",
        "basePoints": 100
      },
      {
        "id": "autoconhecimento-2",
        "sectionTitle": "Quiz 1 — Autoconhecimento na Liderança",
        "prompt": "Um líder que possui autoconhecimento não precisa mais desenvolver suas competências.",
        "options": [
          { "id": "verdadeiro", "label": "Verdadeiro" },
          { "id": "falso", "label": "Falso" }
        ],
        "correctOptionId": "falso",
        "basePoints": 100,
        "feedback": "O autoconhecimento é justamente o ponto de partida para reconhecer o que precisa continuar sendo desenvolvido."
      },
      {
        "id": "autoconhecimento-3",
        "sectionTitle": "Quiz 1 — Autoconhecimento na Liderança",
        "prompt": "O que representa melhor a diferença entre intenção e impacto?",
        "options": [
          { "id": "a", "label": "A intenção sempre determina como o comportamento será recebido." },
          { "id": "b", "label": "O impacto representa como o comportamento é percebido pelo outro, independentemente da intenção original." },
          { "id": "c", "label": "Intenção e impacto são sempre iguais." },
          { "id": "d", "label": "O impacto não deve ser considerado pelo líder." }
        ],
        "correctOptionId": "b",
        "basePoints": 100
      },
      {
        "id": "autoconhecimento-4",
        "sectionTitle": "Quiz 1 — Autoconhecimento na Liderança",
        "prompt": "Pontos cegos são aspectos do nosso comportamento que outras pessoas podem perceber, mas que nós mesmos não identificamos facilmente.",
        "options": [
          { "id": "verdadeiro", "label": "Verdadeiro" },
          { "id": "falso", "label": "Falso" }
        ],
        "correctOptionId": "verdadeiro",
        "basePoints": 100
      },
      {
        "id": "autoconhecimento-5",
        "sectionTitle": "Quiz 1 — Autoconhecimento na Liderança",
        "prompt": "Diante de um feedback, uma postura de desenvolvimento seria:",
        "options": [
          { "id": "a", "label": "Justificar imediatamente o próprio comportamento." },
          { "id": "b", "label": "Ignorar o feedback quando discordar dele." },
          { "id": "c", "label": "Considerar o feedback como uma informação que pode contribuir para o autoconhecimento." },
          { "id": "d", "label": "Entender o feedback como uma avaliação definitiva sobre sua capacidade." }
        ],
        "correctOptionId": "c",
        "basePoints": 100
      },
      {
        "id": "competencias-1",
        "sectionTitle": "Quiz 2 — Competências de Liderança",
        "prompt": "Qual alternativa apresenta corretamente as cinco dimensões trabalhadas nesta mini aula?",
        "options": [
          { "id": "a", "label": "Autoliderança, comunicação, gestão de pessoas, resultados e liderança saudável." },
          { "id": "b", "label": "Comunicação, vendas, marketing, finanças e tecnologia." },
          { "id": "c", "label": "Autonomia, produtividade, vendas, negociação e inovação." },
          { "id": "d", "label": "Estratégia, carreira, finanças, comunicação e legislação." }
        ],
        "correctOptionId": "a",
        "basePoints": 100
      },
      {
        "id": "competencias-2",
        "sectionTitle": "Quiz 2 — Competências de Liderança",
        "prompt": "Uma pessoa pode conhecer uma técnica de liderança e ainda assim não apresentar essa competência de forma consistente em seu comportamento.",
        "options": [
          { "id": "verdadeiro", "label": "Verdadeiro" },
          { "id": "falso", "label": "Falso" }
        ],
        "correctOptionId": "verdadeiro",
        "basePoints": 100
      },
      {
        "id": "competencias-3",
        "sectionTitle": "Quiz 2 — Competências de Liderança",
        "prompt": "Qual comportamento está mais relacionado à competência de gestão de pessoas?",
        "options": [
          { "id": "a", "label": "Centralizar todas as decisões." },
          { "id": "b", "label": "Delegar, acompanhar e desenvolver os integrantes da equipe." },
          { "id": "c", "label": "Evitar conversas difíceis." },
          { "id": "d", "label": "Priorizar somente as próprias atividades." }
        ],
        "correctOptionId": "b",
        "basePoints": 100
      },
      {
        "id": "competencias-4",
        "sectionTitle": "Quiz 2 — Competências de Liderança",
        "prompt": "Liderança saudável envolve apenas evitar conflitos dentro da equipe.",
        "options": [
          { "id": "verdadeiro", "label": "Verdadeiro" },
          { "id": "falso", "label": "Falso" }
        ],
        "correctOptionId": "falso",
        "basePoints": 100,
        "feedback": "Liderança saudável envolve também respeito, comunicação, segurança psicológica, prevenção de assédio, gestão de conflitos e atenção aos fatores que podem afetar a saúde das pessoas."
      },
      {
        "id": "competencias-5",
        "sectionTitle": "Quiz 2 — Competências de Liderança",
        "prompt": "Qual é o principal objetivo do Diagnóstico Individual de Liderança?",
        "options": [
          { "id": "a", "label": "Classificar os líderes do melhor para o pior." },
          { "id": "b", "label": "Identificar quem está preparado para receber uma promoção." },
          { "id": "c", "label": "Identificar forças e oportunidades de desenvolvimento para orientar a jornada do líder." },
          { "id": "d", "label": "Avaliar exclusivamente o conhecimento técnico dos líderes." }
        ],
        "correctOptionId": "c",
        "basePoints": 100
      },
      {
        "id": "diagnostico-final",
        "sectionTitle": "Avaliação final do módulo",
        "prompt": "Qual das dimensões de liderança você acredita que será seu principal desafio de desenvolvimento?",
        "options": [
          { "id": "autolideranca", "label": "Autoliderança" },
          { "id": "comunicacao", "label": "Comunicação" },
          { "id": "gestao-pessoas", "label": "Gestão de pessoas" },
          { "id": "gestao-resultados", "label": "Gestão de resultados" },
          { "id": "lideranca-saudavel", "label": "Liderança saudável" }
        ],
        "isReflection": true,
        "feedback": "Esta resposta não altera sua pontuação e será considerada no diagnóstico de desenvolvimento."
      }
    ]
  }
  $activities$::jsonb
WHERE module."order" = 0
  AND EXISTS (
    SELECT 1
    FROM "Course" AS course
    WHERE course."id" = module."courseId"
      AND course."title" = 'Programa Líder em Ação'
  );
