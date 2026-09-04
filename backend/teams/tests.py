from django.test import TestCase

from .serializers import TeamSerializer


class TeamLocationSerializerTests(TestCase):
    def team_data(self, **overrides):
        data = {
            "name": "Imadol Strikers",
            "description": "A regular Cricksal squad.",
            "location": "Kathmandu",
            "preferred_playing_area": "Baneshwor",
            "preferred_playing_time": "Saturday morning",
            "skill_level": "INTERMEDIATE",
        }
        data.update(overrides)
        return data

    def test_map_resolved_area_sets_the_canonical_district(self):
        serializer = TeamSerializer(data=self.team_data(preferred_playing_area_code="imadol"))

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["preferred_playing_area"], "Imadol")
        self.assertEqual(serializer.validated_data["location"], "Lalitpur")

    def test_new_team_rejects_an_uncontrolled_playing_area(self):
        serializer = TeamSerializer(data=self.team_data(preferred_playing_area="Some random place"))

        self.assertFalse(serializer.is_valid())
        self.assertIn("preferred_playing_area", serializer.errors)
