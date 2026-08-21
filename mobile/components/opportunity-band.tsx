import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { colors, spacing } from './theme';
import { OpportunityCard, OPPORTUNITY_CARD_STRIDE } from './opportunity-card';
import type { Opportunity } from '../lib/api';

// ============================================================================
// LA BANDE D'OFFRES — UNE SEULE IMPLÉMENTATION, DEUX PUBLICS
//
// Ce composant est le CARROUSEL DÉJÀ EN PLACE sur l'accueil connecté, extrait
// tel quel pour être partagé avec l'accueil public (V6-2). Rien de son
// comportement n'a été redessiné : même défilement automatique, même pause au
// toucher, mêmes puces de position, mêmes cartes sans image.
//
// POURQUOI UNE EXTRACTION ET NON UN SECOND CARROUSEL. Deux implémentations de
// la même bande auraient divergé à la première correction — l'une recevant le
// correctif, l'autre non. La gouvernance V6-2 l'interdit explicitement.
//
// CE QUI REND CE COMPOSANT UTILISABLE SANS COMPTE : `onToggleFavorite` est
// FACULTATIF. Absent, la carte ne rend simplement pas l'action — elle n'est pas
// offerte puis refusée. C'était déjà le comportement de l'accueil connecté, qui
// passait `accessToken ? … : undefined`.
// ============================================================================

// Défilement automatique du carrousel — jamais en scroll infini caché : une puce par
// offre, l'utilisateur voit toujours où il en est et combien il en reste (design
// comportemental, artifact "Le Passeport"). Le geste de l'utilisateur a toujours
// priorité — reprend seulement après une pause, sans jamais l'interrompre.
const AUTO_SCROLL_INTERVAL_MS = 4000;
const RESUME_AFTER_INTERACTION_MS = 6000;

export function OpportunityBand({
  opportunities,
  favoriteIds,
  onToggleFavorite,
  onPressOpportunity,
}: {
  opportunities: Opportunity[];
  favoriteIds?: Set<string>;
  // Facultatif À DESSEIN : c'est ce qui rend la bande utilisable par un
  // visiteur sans compte, sans dupliquer le composant.
  onToggleFavorite?: (opportunityId: string) => void;
  onPressOpportunity: (opportunityId: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [isReduceMotionEnabled, setIsReduceMotionEnabled] = useState(false);
  const carouselRef = useRef<ScrollView>(null);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setIsReduceMotionEnabled);
    return () => {
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    };
  }, []);

  // Le rafraîchissement au focus peut réduire la liste — repartir de la première
  // offre plutôt que garder un index devenu hors limites.
  useEffect(() => {
    setActiveIndex(0);
  }, [opportunities.length]);

  useEffect(() => {
    if (isReduceMotionEnabled || isAutoScrollPaused || opportunities.length < 2) return;
    const interval = setInterval(() => {
      setActiveIndex((current) => {
        const next = (current + 1) % opportunities.length;
        carouselRef.current?.scrollTo({ x: next * OPPORTUNITY_CARD_STRIDE, animated: true });
        return next;
      });
    }, AUTO_SCROLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isReduceMotionEnabled, isAutoScrollPaused, opportunities.length]);

  // L'utilisateur qui touche le carrousel reprend toujours la main immédiatement — le
  // défilement automatique ne reprend qu'après une pause, jamais en pleine interaction.
  function handleCarouselTouchStart() {
    setIsAutoScrollPaused(true);
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
  }

  function handleCarouselScrollEnd(offsetX: number) {
    setActiveIndex(Math.round(offsetX / OPPORTUNITY_CARD_STRIDE));
    resumeTimeoutRef.current = setTimeout(
      () => setIsAutoScrollPaused(false),
      RESUME_AFTER_INTERACTION_MS,
    );
  }

  return (
    <>
      <ScrollView
        ref={carouselRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carousel}
        onTouchStart={handleCarouselTouchStart}
        onMomentumScrollEnd={(event) =>
          handleCarouselScrollEnd(event.nativeEvent.contentOffset.x)
        }
        snapToInterval={OPPORTUNITY_CARD_STRIDE}
        decelerationRate="fast"
      >
        {opportunities.map((opportunity) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            compact
            isFavorite={favoriteIds?.has(opportunity.id) ?? false}
            onToggleFavorite={
              onToggleFavorite ? () => onToggleFavorite(opportunity.id) : undefined
            }
            onPress={() => onPressOpportunity(opportunity.id)}
          />
        ))}
      </ScrollView>
      {opportunities.length > 1 && (
        <View style={styles.dots} accessibilityElementsHidden>
          {opportunities.map((opportunity, index) => (
            <View
              key={opportunity.id}
              style={[styles.dot, index === activeIndex && styles.dotActive]}
            />
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  carousel: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.mistStrong,
  },
  dotActive: {
    width: 16,
    backgroundColor: colors.accent,
  },
});
