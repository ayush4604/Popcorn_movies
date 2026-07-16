import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Text, Image, Dimensions } from 'react-native';

interface AnimatedSplashProps {
  onFinish: () => void;
}

const { width } = Dimensions.get('window');

export default function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  // Animation Values
  const kernelScale = useRef(new Animated.Value(0)).current;
  const kernelOpacity = useRef(new Animated.Value(0)).current;
  
  const flashScale = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;

  const logoScale = useRef(new Animated.Value(0.2)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  
  const textTranslateY = useRef(new Animated.Value(20)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  
  const masterOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // 1. Kernel comes on screen
      Animated.parallel([
        Animated.timing(kernelOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(kernelScale, {
          toValue: 1,
          friction: 4,
          tension: 40,
          useNativeDriver: true,
        }),
      ]),
      // Hold kernel
      Animated.delay(500),
      
      // 2. Explode! (Flash expands, kernel hides)
      Animated.parallel([
        Animated.timing(kernelOpacity, {
          toValue: 0,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(flashOpacity, {
          toValue: 1,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(flashScale, {
          toValue: Math.max(width * 2, 800), // Huge scale to cover screen
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        })
      ]),

      // 3. Transformation (Flash fades out, Logo appears)
      Animated.parallel([
        Animated.timing(flashOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 5,
          tension: 80,
          useNativeDriver: true,
        })
      ]),

      // 4. Text fades in
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(textTranslateY, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        })
      ]),

      // Hold for a moment
      Animated.delay(1000),

      // 5. Fade out entire splash to reveal app
      Animated.timing(masterOpacity, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })

    ]).start(() => {
      onFinish();
    });
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: masterOpacity }]}>
      
      {/* The Kernel */}
      <Animated.Image 
        source={require('../../assets/images/kernel.jpg')}
        style={[styles.kernel, { opacity: kernelOpacity, transform: [{ scale: kernelScale }] }]}
        resizeMode="contain"
      />

      {/* The Explosion Flash */}
      <Animated.View 
        style={[styles.flash, { opacity: flashOpacity, transform: [{ scale: flashScale }] }]} 
      />

      {/* The Final Logo */}
      <Animated.Image 
        source={require('../../assets/images/logo.jpg')} 
        style={[styles.logo, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]} 
        resizeMode="contain"
      />

      {/* The Text Reveal */}
      <Animated.View
        style={{
          opacity: textOpacity,
          transform: [{ translateY: textTranslateY }],
          marginTop: 20,
          position: 'absolute',
          bottom: '30%',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <Text style={styles.textTop}>POPCORN</Text>
        <Text style={styles.textBottom}>MOVIES</Text>
      </Animated.View>

    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  kernel: {
    width: 60,
    height: 60,
    position: 'absolute',
  },
  flash: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ffffff',
    position: 'absolute',
  },
  logo: {
    width: 140,
    height: 140,
    position: 'absolute',
    marginTop: -80, // Offset to make room for text
  },
  textTop: {
    color: '#e50914',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  textBottom: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '300',
    letterSpacing: 8,
    textAlign: 'center',
    marginTop: -4,
  },
});
