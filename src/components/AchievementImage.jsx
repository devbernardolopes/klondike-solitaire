import { useEffect, useState } from 'react';
import {
  ACHIEVEMENT_PLACEHOLDER,
  achievementImageUrl,
  getCachedAchievementImageUrl,
  onAchievementImageError,
  preloadAchievementImage,
} from '../utils/achievementImage.js';
import {
  ensureAchievementImageCached,
  getAchievementImageUrlSync,
} from '../utils/achievementImageCache.js';

const URL_LIKE = /^(https?|blob|data):/i;

export default function AchievementImage({ achievement, alt = '', style }) {
  const imagePath = achievement?.image_path ?? '';
  const isUrlLike = typeof imagePath === 'string' && URL_LIKE.test(imagePath);
  const url = isUrlLike ? achievementImageUrl(imagePath) : getAchievementImageUrlSync(imagePath);
  const identity = `${achievement?.id ?? ''}:${imagePath}:${url}`;
  const [src, setSrc] = useState(() => getCachedAchievementImageUrl(url) || ACHIEVEMENT_PLACEHOLDER);

  useEffect(() => {
    let current = true;
    setSrc(getCachedAchievementImageUrl(url) || ACHIEVEMENT_PLACEHOLDER);
    (async () => {
      if (!isUrlLike) {
        try { await ensureAchievementImageCached(imagePath); } catch {}
        if (!current) return;
        const freshUrl = getAchievementImageUrlSync(imagePath);
        const loadedUrl = await preloadAchievementImage(freshUrl);
        if (current) setSrc(loadedUrl || ACHIEVEMENT_PLACEHOLDER);
        return;
      }
      const loadedUrl = await preloadAchievementImage(url);
      if (current) setSrc(loadedUrl || ACHIEVEMENT_PLACEHOLDER);
    })();
    return () => { current = false; };
  }, [identity, url, imagePath, isUrlLike]);

  return <img key={identity} src={src} alt={alt} onError={onAchievementImageError} style={style} />;
}