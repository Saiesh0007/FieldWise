# osmdroid and JTS load classes reflectively; keep them whole.
-keep class org.locationtech.jts.** { *; }
-keep class org.osmdroid.** { *; }
-dontwarn org.locationtech.jts.**
-dontwarn org.slf4j.**
-dontwarn org.osmdroid.**

# Readable crash reports in Play Console.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
