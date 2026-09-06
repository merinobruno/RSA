package com.rsa.telemetry.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [PacketEntity::class], version = 2, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {

    abstract fun packetDao(): PacketDao

    companion object {
        private const val DATABASE_NAME = "telemetry.db"

        /**
         * Adds [PacketEntity.rejectionReason].
         *
         * A real migration rather than `fallbackToDestructiveMigration()`: the queue can be
         * holding a full day of un-uploaded flight data when the app is updated, and wiping it on
         * upgrade would destroy exactly the data this app exists to protect. The new column is
         * nullable, so existing rows need no backfill.
         */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE packets ADD COLUMN rejectionReason TEXT")
            }
        }

        @Volatile
        private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    DATABASE_NAME,
                ).addMigrations(MIGRATION_1_2)
                    .build()
                    .also { instance = it }
            }
    }
}
