import { AbsoluteFill, Video } from "remotion";
import { toMediaSrc } from "../types";

type Props = {
  basePitchVideoPath: string;
};

// 8s onward: the user's own pre-recorded pitch, played back unmodified.
// Only rendered when a base pitch video has actually been provided —
// PersonalizedOutreachVideo skips this segment entirely otherwise.
export function BasePitch({ basePitchVideoPath }: Props) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Video src={toMediaSrc(basePitchVideoPath)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </AbsoluteFill>
  );
}
