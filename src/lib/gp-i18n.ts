import type { Language } from "./i18n";

const PT = {
  menuButton: "MODO GP ONLINE",
  hubTitle: "MODO GP",
  hubSub: "GRAND VALLEY SPEEDWAY",
  practice: "TREINO OFFLINE",
  practiceDesc: "Pista livre, sem adversários. Escolha seu carro e vá para o pit.",
  championship: "CAMPEONATO GP ONLINE",
  championshipDesc: "Dispute o campeonato contra pilotos do mundo todo.",
  open: "LIBERADO",
  locked: "BLOQUEADO",
  demoTitle: "Versão DEMO",
  demoMsg:
    "O Campeonato GP Online ainda não está disponível. O jogo está na versão DEMO e o modo online vai chegar nas próximas atualizações.",
  ok: "ENTENDI",
  loading: "CARREGANDO PISTA",
  selectTitle: "SELEÇÃO DE CARRO",
  selectHint: "Toque no carro liberado para ir ao pit",
  unavailable: "INDISPONÍVEL",
  choose: "ESCOLHER",
  pitTitle: "PIT STOP",
  pitHint: "Arraste para olhar o carro • pinça ou roda do mouse para zoom",
  back: "VOLTAR",
  exit: "SAIR",
  error: "Não foi possível carregar a pista",
};

type GpText = typeof PT;

const EN: GpText = {
  menuButton: "ONLINE GP MODE",
  hubTitle: "GP MODE",
  hubSub: "GRAND VALLEY SPEEDWAY",
  practice: "OFFLINE PRACTICE",
  practiceDesc: "Open track, no rivals. Pick your car and head to the pit.",
  championship: "ONLINE GP CHAMPIONSHIP",
  championshipDesc: "Race the championship against drivers worldwide.",
  open: "OPEN",
  locked: "LOCKED",
  demoTitle: "DEMO version",
  demoMsg:
    "The Online GP Championship is not available yet. The game is still a DEMO and online mode is coming in future updates.",
  ok: "GOT IT",
  loading: "LOADING TRACK",
  selectTitle: "CAR SELECT",
  selectHint: "Tap the unlocked car to go to the pit",
  unavailable: "UNAVAILABLE",
  choose: "SELECT",
  pitTitle: "PIT STOP",
  pitHint: "Drag to look around the car • pinch or wheel to zoom",
  back: "BACK",
  exit: "EXIT",
  error: "The track could not be loaded",
};

export function gpText(lang: Language): GpText {
  return lang === "pt-BR" || lang === "pt-PT" ? PT : EN;
}
