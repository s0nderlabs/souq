"use client";

import { motion } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="mb-8">
      <motion.h1
        variants={fadeUp}
        className="font-display italic text-3xl sm:text-4xl text-ink tracking-tight leading-tight"
      >
        {title}
      </motion.h1>
      {subtitle && (
        <motion.p variants={fadeUp} className="font-serif text-base text-ink-light mt-2 max-w-lg">
          {subtitle}
        </motion.p>
      )}
    </motion.div>
  );
}
