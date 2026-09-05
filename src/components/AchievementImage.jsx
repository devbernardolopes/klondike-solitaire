import { useEffect, useState } from 'react';
import {
  ACHIEVEMENT_PLACEHOLDER,
  achievementImageUrl,
  preloadAchievementImage,
} from '../utils/achievementImage.js';

export default function AchievementImage({ achievement, alt = '', style }) {
  const imagePath = achievement?.image_path ?? '';
  const url = achievementImageUrl(imagePath);
  const identity = `${achievement?.id ?? ''}:${imagePath}:${url}`;
  const [src, setSrc] = useState(ACHIEVEMENT_PLACEHOLDER);

  useEffect(() => {
    let current = true;
    setSrc(ACHIEVEMENT_PLACEHOLDER);
    preloadAchievementImage(url).then((loadedUrl) => {
      if (current) setSrc(loadedUrl || ACHIEVEMENT_PLACEHOLDER);
    });
    return () => { current = false; };
  }, [identity, url]);

  return <img key={identity} src={src} alt={alt} style={style} />;
}