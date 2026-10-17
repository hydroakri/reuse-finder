// SCRUM-76: generic, category/item-type repair advice -- deliberately NOT
// claims about any specific business's process or policy (we have no
// first-hand source for that per listing, and inventing one would be
// fabricating facts about a real organisation). These are universally
// applicable preparation tips, the kind any repair café/hub would give.
const REPAIR_TIPS = [
  {
    keywords: ["bike", "bicycle", "cycle"],
    tip: "Note any recent falls or unusual noises before you go -- it helps the mechanic diagnose faster than a cold inspection.",
  },
  {
    keywords: ["laptop", "computer", "phone", "electronics", "tablet", "appliance"],
    tip: "Back up your data and bring the charger/cable -- most repair cafés can't properly test a device without power.",
  },
  {
    keywords: ["clothing", "textile", "coat", "jacket", "sewing", "shoe"],
    tip: "Bring a spare button/zip/lace if you have one, and point out the exact tear or seam to speed up a koha-based repair.",
  },
  {
    keywords: ["furniture", "wood", "chair", "table"],
    tip: "Take a photo of the wobble or crack beforehand -- it helps tell a loose joint from a material failure.",
  },
];

const DEFAULT_REPAIR_TIP =
  "Describe the fault as specifically as you can and bring any related accessories or spare parts.";

export function getRepairTip(item, notes) {
  const haystack = `${item || ""} ${notes || ""}`.toLowerCase();
  const match = REPAIR_TIPS.find((entry) => entry.keywords.some((keyword) => haystack.includes(keyword)));
  return match?.tip ?? DEFAULT_REPAIR_TIP;
}
