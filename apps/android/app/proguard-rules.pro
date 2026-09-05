# kotlinx.serialization generates a companion `serializer()` per @Serializable class and looks it
# up reflectively at the point a type is decoded. R8 cannot see that call, so without these the
# release build strips the serializers and every decode fails at runtime rather than at build.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class **$$serializer { *** INSTANCE; }
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
    *** serializer(...);
}
