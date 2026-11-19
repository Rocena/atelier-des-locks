// @ts-check
import { initCommon, showThreadsStatic, withMotion } from '../common.js';

initCommon();
withMotion((motion) => {
  motion.splitTitles();
  motion.drawThreads();
  motion.parallax();
}, showThreadsStatic);
