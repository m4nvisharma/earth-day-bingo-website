const rulesContent = document.getElementById("rulesContent");

async function loadRules() {
  if (!rulesContent) return;
  try {
    const response = await fetch("content/copy.json");
    if (!response.ok) throw new Error("Unable to load rules");
    const data = await response.json();
    const rules = data.rules || {};

    rulesContent.innerHTML = "";

    const introCard = document.createElement("section");
    introCard.className = "rules-intro-card";

    const title = document.createElement("h2");
    title.textContent = rules.title || "Rules";
    introCard.appendChild(title);

    if (rules.intro) {
      const intro = document.createElement("p");
      intro.className = "lede";
      intro.textContent = rules.intro;
      introCard.appendChild(intro);
    }

    rulesContent.appendChild(introCard);

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

    const contactSection = document.createElement("section");
    contactSection.className = "rules-section rules-contact-section";

    const contactHeading = document.createElement("h3");
    contactHeading.textContent = "Contact";
    contactSection.appendChild(contactHeading);

    const contactText = document.createElement("p");
    contactText.append("You can email us directly to ");

    const emailLink = document.createElement("a");
    emailLink.href = "mailto:info@cycat.com";
    emailLink.textContent = "info@cycat.com";
    contactText.appendChild(emailLink);

    contactText.append(" (preferred), or you can use the ");

    const contactPageLink = document.createElement("a");
    contactPageLink.href = "contact.html";
    contactPageLink.textContent = "contact page";
    contactText.appendChild(contactPageLink);

    contactText.append(".");
    contactSection.appendChild(contactText);
    rulesContent.appendChild(contactSection);
  } catch (error) {
    rulesContent.textContent = error.message;
  }
}

loadRules();
