const rulesContent = document.getElementById("rulesContent");

async function loadRules() {
  if (!rulesContent) return;
  try {
    const response = await fetch("content/copy.json");
    if (!response.ok) throw new Error("Unable to load rules");
    const data = await response.json();
    const rules = data.rules || {};

    rulesContent.innerHTML = "";

    const title = document.createElement("h2");
    title.textContent = rules.title || "Rules";
    rulesContent.appendChild(title);

    if (rules.intro) {
      const intro = document.createElement("p");
      intro.className = "lede";
      intro.textContent = rules.intro;
      rulesContent.appendChild(intro);
    }

    (rules.sections || []).forEach((section) => {
      const wrap = document.createElement("section");
      wrap.className = "rules-section";

      const heading = document.createElement("h3");
      heading.textContent = section.title || "";
      wrap.appendChild(heading);

      if (Array.isArray(section.bullets) && section.bullets.length > 0) {
        const list = document.createElement("ul");
        section.bullets.forEach((item) => {
          const li = document.createElement("li");
          li.textContent = item;
          list.appendChild(li);
        });
        wrap.appendChild(list);
      }

      rulesContent.appendChild(wrap);
    });
  } catch (error) {
    rulesContent.textContent = error.message;
  }
}

loadRules();
