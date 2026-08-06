import 'package:flutter/material.dart';

/// Scanner dark theme — tokens verbatim from design/mockups/scanner.html.
/// The light organiser semantics are too dim on charcoal; these are the
/// dedicated dark values.
abstract final class Palette {
  static const ground = Color(0xFF12140F);
  static const surface = Color(0xFF1C1F19);
  static const surface2 = Color(0xFF262A22);
  static const line = Color(0xFF333829);
  static const text = Color(0xFFF5F7F2);
  static const muted = Color(0xFF8A9187);

  static const admit = Color(0xFF4ADE80);
  static const admitWash = Color(0xFF132A1B);
  static const hold = Color(0xFFFBBF24);
  static const holdWash = Color(0xFF2B2210);
  static const deny = Color(0xFFF87171);
  static const denyWash = Color(0xFF2C1616);
}

ThemeData scannerTheme() => ThemeData(
  brightness: Brightness.dark,
  scaffoldBackgroundColor: Palette.ground,
  colorScheme: const ColorScheme.dark(
    surface: Palette.surface,
    primary: Palette.admit,
    error: Palette.deny,
    onSurface: Palette.text,
  ),
  fontFamily: 'Inter',
  dividerColor: Palette.line,
  appBarTheme: const AppBarTheme(
    backgroundColor: Palette.ground,
    foregroundColor: Palette.text,
    elevation: 0,
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white.withValues(alpha: .06),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide(color: Colors.white.withValues(alpha: .13)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide(color: Colors.white.withValues(alpha: .13)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: const BorderSide(color: Palette.admit),
    ),
    hintStyle: const TextStyle(color: Palette.muted),
  ),
);
