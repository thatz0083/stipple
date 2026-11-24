import type { PackRecipe } from "@/lib/dots-data";

export type Recipe = PackRecipe;

// Kept as a default export for any legacy imports.
export const BULGOGI: Recipe = {
  id: "bulgogi",
  title: "불고기",
  serves: "2인분",
  total: "약 25분",
  ingredients: [
    { item: "소고기 (불고기감)", amount: "300g" },
    { item: "양파", amount: "1/2개" },
    { item: "대파", amount: "1대" },
    { item: "간장 양념", amount: "3 큰술" },
  ],
  steps: [
    { t: "양념을 만들어 고기를 재운다.", minutes: 20 },
    { t: "센 불에 양파와 볶는다.", minutes: 6 },
    { t: "대파를 넣고 마무리.", minutes: 2 },
  ],
  tip: "배를 갈아 넣으면 고기가 연해져.",
};

// Phase EN-fix C: lang === "en" 시 EN 데이터 필드 (titleEn / ingredientsEn /
// stepsEn / tipEn / servesEn / totalEn) 우선, 미박힘 시 KO fallback. 한국어
// 모드는 KO 필드 그대로 — 회귀 0. 음식 이름 (titleEn) 은 로마자 + 영어 병기로
// 한국 요리 정체성 유지 ("Baek-style Kimchi-jjigae (Pork Kimchi Stew)").
export function RecipeCard({ recipe, lang = "ko" }: { recipe: Recipe; lang?: "ko" | "en" }) {
  const en = lang === "en";
  const L = en
    ? { ingredients: "Ingredients", steps: "Steps", tips: "Tips", minSuffix: " min" }
    : { ingredients: "재료", steps: "순서", tips: "팁", minSuffix: "분" };
  const title = en ? (recipe.titleEn ?? recipe.title) : recipe.title;
  const serves = en ? (recipe.servesEn ?? recipe.serves) : recipe.serves;
  const total = en ? (recipe.totalEn ?? recipe.total) : recipe.total;
  const ingredients = en ? (recipe.ingredientsEn ?? recipe.ingredients) : recipe.ingredients;
  const steps = en ? (recipe.stepsEn ?? recipe.steps) : recipe.steps;
  const tip = en ? (recipe.tipEn ?? recipe.tip) : recipe.tip;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden max-w-2xl">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h3>
        <p className="text-[12px] text-ink-soft mt-0.5">
          {serves} · {total}
        </p>
      </div>

      <div className="grid md:grid-cols-[180px_1fr] gap-x-8 gap-y-6 px-5 py-5">
        <section>
          <h4 className="text-[10.5px] uppercase tracking-[0.14em] text-ink-soft mb-3">
            {L.ingredients}
          </h4>
          <ul className="space-y-2">
            {ingredients.map((i) => (
              <li key={i.item} className="text-[13px] leading-snug">
                <div className="text-ink">{i.item}</div>
                <div className="text-ink-soft text-[12px]">{i.amount}</div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h4 className="text-[10.5px] uppercase tracking-[0.14em] text-ink-soft mb-3">
            {L.steps}
          </h4>
          <ol className="space-y-3">
            {steps.map((s, idx) => (
              <li key={idx} className="flex gap-3">
                <span className="font-mono text-[11px] text-ink-soft pt-[3px] w-5 shrink-0">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="flex-1">
                  <p className="text-[13.5px] text-ink leading-relaxed">{s.t}</p>
                  {s.minutes && (
                    <p className="font-mono text-[10.5px] text-ink-soft mt-0.5">
                      {s.minutes}
                      {L.minSuffix}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 pt-5 border-t border-border">
            <h4 className="text-[10.5px] uppercase tracking-[0.14em] text-ink-soft mb-2">
              {L.tips}
            </h4>
            <p className="text-[12.5px] text-ink-soft leading-relaxed pl-3 border-l border-border">
              {tip}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
