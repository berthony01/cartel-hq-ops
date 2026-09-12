/**
 * PP2-V2-1C — pure validator/parser regression for the rich profile data layer.
 * Executes the real exported helpers. Performs NO database access.
 */
import {
  ABOUT_LONG_MAX,
  HIGHLIGHT_MAX,
  PROFILE_RESOURCE_URL_MAX,
  ProfileContentValidationError,
  TAGLINE_MAX,
  extractYouTubeVideoId,
  normalizeAboutLong,
  normalizeHighlights,
  normalizeResourceUrl,
  normalizeTagline,
} from "../src/lib/project-profile";

let failures = 0;

function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}

function rejects(name: string, fn: () => unknown) {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = error instanceof ProfileContentValidationError;
  }
  check(name, threw);
}

const ID = "dQw4w9WgXcQ";

check("watch URL", extractYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}`) === ID);
check("bare youtube.com watch", extractYouTubeVideoId(`https://youtube.com/watch?v=${ID}&t=5s`) === ID);
check("m.youtube watch", extractYouTubeVideoId(`https://m.youtube.com/watch?v=${ID}`) === ID);
check("youtu.be", extractYouTubeVideoId(`https://youtu.be/${ID}`) === ID);
check("shorts", extractYouTubeVideoId(`https://www.youtube.com/shorts/${ID}`) === ID);
check("embed", extractYouTubeVideoId(`https://www.youtube.com/embed/${ID}`) === ID);
check("bare 11-char id", extractYouTubeVideoId(ID) === ID);

check("fake host suffix rejected", extractYouTubeVideoId(`https://youtube.com.evil.example/watch?v=${ID}`) === null);
check("iframe HTML rejected", extractYouTubeVideoId(`<iframe src="https://www.youtube.com/embed/${ID}"></iframe>`) === null);
check("javascript: rejected", extractYouTubeVideoId(`javascript:alert(1)`) === null);
check("data: rejected", extractYouTubeVideoId("data:text/html,<b>x</b>") === null);
check("short id rejected", extractYouTubeVideoId("abc123") === null);
check("long id rejected", extractYouTubeVideoId("dQw4w9WgXcQXX") === null);
check("non-youtube host rejected", extractYouTubeVideoId(`https://vimeo.com/watch?v=${ID}`) === null);
check("music.youtube.com rejected", extractYouTubeVideoId(`https://music.youtube.com/watch?v=${ID}`) === null);
check("www.youtu.be rejected", extractYouTubeVideoId(`https://www.youtu.be/${ID}`) === null);
check("/v/ID rejected", extractYouTubeVideoId(`https://www.youtube.com/v/${ID}`) === null);
check("youtu.be extra segment rejected", extractYouTubeVideoId(`https://youtu.be/x/${ID}`) === null);
check("shorts extra segment rejected", extractYouTubeVideoId(`https://www.youtube.com/x/shorts/${ID}`) === null);
check("embed extra segment rejected", extractYouTubeVideoId(`https://www.youtube.com/embed/${ID}/extra`) === null);
check("shorts query kept", extractYouTubeVideoId(`https://www.youtube.com/shorts/${ID}?feature=share#t=1`) === ID);

const highlights = normalizeHighlights(["  Alpha ", "", "  ", "Beta"]);
check("highlights trim/drop/order", JSON.stringify(highlights) === JSON.stringify(["Alpha", "Beta"]));
check("empty highlights become null", normalizeHighlights(["", "  "]) === null);
rejects("more than 6 highlights rejected", () =>
  normalizeHighlights(["a", "b", "c", "d", "e", "f", "g"]),
);
rejects("over-long highlight rejected", () => normalizeHighlights(["x".repeat(HIGHLIGHT_MAX + 1)]));

check("tagline at max accepted", normalizeTagline("x".repeat(TAGLINE_MAX))?.length === TAGLINE_MAX);
rejects("tagline over max rejected", () => normalizeTagline("x".repeat(TAGLINE_MAX + 1)));
check("about at max accepted", normalizeAboutLong("x".repeat(ABOUT_LONG_MAX))?.length === ABOUT_LONG_MAX);
rejects("about over max rejected", () => normalizeAboutLong("x".repeat(ABOUT_LONG_MAX + 1)));

check("https docs url accepted", normalizeResourceUrl("https://docs.example.com/x", "Docs link") === "https://docs.example.com/x");
check("empty url becomes null", normalizeResourceUrl("   ", "Docs link") === null);
rejects("javascript url rejected", () => normalizeResourceUrl("javascript:alert(1)", "Docs link"));
rejects("data url rejected", () => normalizeResourceUrl("data:text/html,x", "GitHub link"));
rejects("scheme-less url rejected", () => normalizeResourceUrl("github.com/acme", "GitHub link"));
rejects("over-long url rejected", () =>
  normalizeResourceUrl(`https://x.example/${"a".repeat(PROFILE_RESOURCE_URL_MAX)}`, "Docs link"),
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
