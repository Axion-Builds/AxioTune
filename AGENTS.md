# AxioTune Project Rules & Standards

## 1. Web Typography Guidelines & Mandatory Skill
- Whenever tasked with improving, modifying, or reviewing fonts, typography, text styling, or reading comfort, **ALWAYS** activate and adhere to the `web-typography` skill (`.agents/skills/web-typography/SKILL.md` or `~/.gemini/config/skills/web-typography/SKILL.md`).
- **Zero Guesswork / Random Swapping**: Never introduce unvetted display fonts or arbitrary font pairings without scoring against the 10-point diagnostic rubric in `web-typography`.
- **Rhythm & Hierarchy**: Ensure clear scale ratio between hierarchy levels. Body text measure must stay within 45–75 characters (ideal 65ch) with 1.4–1.7 line-height. Headings should be tighter (1.1–1.25).
- **Font Selection**: Default to proven web typography pairings (e.g. Outfit / Inter / system stacks) unless explicitly instructed otherwise with user approval.

## 2. AxioTune Architecture Constraints
- **Preserve Canvas Transparency on `#player-screen`**:
  `#player-screen` must strictly remain `background: transparent;` without blur filters or solid overlays. The dynamic WebGL fluid shader (`#webgl-canvas` via `kawarp.js`) renders behind it. Any opaque background or heavy filter ruins the ambient visual experience.
- **Git Execution**:
  Git executable path on this system: `C:\Users\Adarsh shukla\AppData\Local\GitHubDesktop\app-3.6.3\resources\app\git\cmd\git.exe`.
- **Production Verification**:
  Always verify responsive layout and console errors before and after any change. Render deploy cycle takes 2-3 minutes.
