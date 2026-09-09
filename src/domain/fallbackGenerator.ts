import { getActiveCurriculum } from "./learningEngine";
import type { AppState, FeedAuthor, GeneratedKnowledgeBundle } from "./types";

export function buildFallbackBundle(state: AppState, currentConceptId: string): GeneratedKnowledgeBundle {
  const curriculum = state.curriculum;
  if (!curriculum) throw new Error("Cannot generate bundle without active curriculum");

  const conceptIndex = curriculum.concepts.findIndex((item) => item.id === currentConceptId);
  if (conceptIndex === -1) throw new Error("Concept not found in active curriculum");

  const concept = curriculum.concepts[conceptIndex];
  const postId = `fb-post-${concept.id}`;
  const timestamp = new Date().toISOString();
  const author = personas.tutor;

  return {
    source: "fallback",
    curriculumId: curriculum.curriculumId,
    conceptId: concept.id,
    lesson: {
      title: `${concept.title}：核心精讲`,
      hook: `快速掌握 ${curriculum.topic.title} 的核心。`,
      explanation: `关于 ${concept.title} 的核心解析。我们不能只背概念，关键是理解它在 ${curriculum.topic.title} 中的实际作用。新手最容易踩的坑是认为“${concept.misconceptionToFix}”。其实并非如此。${concept.plainLanguageGoal}。`,
      analogy: `就像建造房子需要打地基一样，掌握这个知识点是你深入学习 ${curriculum.topic.title} 的基础。`,
      recallPrompt: `用你自己的话总结一下：${concept.title} 为什么重要？`,
      completionFeedback: `非常好！你已经掌握了 ${concept.title} 的核心。接下来让我们去社区看看大家是怎么在实战中运用它的。`
    },
    post: {
      id: postId,
      author: {
        id: author.id,
        name: author.name,
        role: author.role,
        avatarChar: author.avatarChar,
        avatarColor: author.avatarColor
      },
      content: `关于 ${concept.title} 的核心解析。我们不能只背概念，关键是理解它在 ${curriculum.topic.title} 中的实际作用。\n\n新手最容易踩的坑是认为“${concept.misconceptionToFix}”。其实并非如此。${concept.plainLanguageGoal}。这不仅是理论，更是你在实战中避开误区、真正掌握这门知识的关键。\n\n接下来，我会给大家分享几个非常实用的记忆口诀和实战案例。如果你在这个知识点上卡住过，欢迎在评论区提出你的困惑。`,
      timestamp,
      likes: 128,
      views: 3400
    },
    threads: [
      {
        id: `fb-thread-1-${concept.id}`,
        participants: [
          { id: personas.studentA.id, name: personas.studentA.name, role: personas.studentA.role, avatarChar: personas.studentA.avatarChar, avatarColor: personas.studentA.avatarColor },
          { id: personas.expertB.id, name: personas.expertB.name, role: personas.expertB.role, avatarChar: personas.expertB.avatarChar, avatarColor: personas.expertB.avatarColor }
        ],
        comments: [
          {
            id: `fb-comment-1-1-${concept.id}`,
            postId,
            authorId: personas.studentA.id,
            content: `请问在实际应用 ${concept.title} 时，最常见的卡点是什么？我总是觉得理论听懂了，但一上手就用错。`,
            timestamp,
            likes: 12
          },
          {
            id: `fb-comment-1-2-${concept.id}`,
            postId,
            authorId: personas.expertB.id,
            content: `最常见的卡点就是把 ${concept.title} 和其他相似概念搞混。记住一个核心原则：${concept.plainLanguageGoal}。只要在这个大前提下，你就不容易偏离方向。你可以试着用刚才提到的案例再练一遍。`,
            replyToId: `fb-comment-1-1-${concept.id}`,
            timestamp,
            likes: 34
          }
        ]
      },
      {
        id: `fb-thread-2-${concept.id}`,
        participants: [
          { id: personas.studentC.id, name: personas.studentC.name, role: personas.studentC.role, avatarChar: personas.studentC.avatarChar, avatarColor: personas.studentC.avatarColor },
          { id: personas.tutor.id, name: personas.tutor.name, role: personas.tutor.role, avatarChar: personas.tutor.avatarChar, avatarColor: personas.tutor.avatarColor }
        ],
        comments: [
          {
            id: `fb-comment-2-1-${concept.id}`,
            postId,
            authorId: personas.studentC.id,
            content: `我之前一直以为 ${concept.misconceptionToFix}，现在看来完全理解错了！这个误区让我绕了很大弯路。`,
            timestamp,
            likes: 5
          },
          {
            id: `fb-comment-2-2-${concept.id}`,
            postId,
            authorId: personas.tutor.id,
            content: `不用担心，这是一个非常经典的易错点。你能识别出这个误区，说明你的认知已经进阶了。接下来重点把这个概念融入到你的日常练习中，多用多练，很快就能形成肌肉记忆。`,
            replyToId: `fb-comment-2-1-${concept.id}`,
            timestamp,
            likes: 18
          }
        ]
      }
    ],
    shadowDraft: {
      id: `fb-draft-${concept.id}`,
      conceptId: concept.id,
      body: `今天学到了 ${concept.title}，纠正了我之前关于“${concept.misconceptionToFix}”的误解。实际上，${concept.plainLanguageGoal}。接下来我要在实际练习中多加注意。`,
      confidence: 85,
      generationSource: "fallback"
    }
  };
}

const personas = {
  tutor: {
    id: "fb-tutor",
    name: "知识领航员",
    role: "资深导师，擅长拆解复杂概念",
    avatarChar: "导",
    avatarColor: "#1a2b4c"
  },
  studentA: {
    id: "fb-studentA",
    name: "好奇学习者",
    role: "勤于提问的实战派",
    avatarChar: "学",
    avatarColor: "#334155"
  },
  expertB: {
    id: "fb-expertB",
    name: "避坑专家",
    role: "经验丰富的从业者",
    avatarChar: "专",
    avatarColor: "#c5a059"
  },
  studentC: {
    id: "fb-studentC",
    name: "反思型学员",
    role: "善于总结误区的新手",
    avatarChar: "悟",
    avatarColor: "#0f172a"
  }
} as const;
